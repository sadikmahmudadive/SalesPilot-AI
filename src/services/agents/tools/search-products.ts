/**
 * `search_products`: keyword search over the organization's catalog, limited to what the agent
 * may see. Server-only.
 *
 * READ BOUND AND COST. One query per call reads at most 1000 products of the organization
 * (`archived == false AND availability == "active"`, ordered by `nameLower`; served by the
 * existing (organizationId, archived, availability, nameLower) index), so drafts and archived
 * products never use up the cap. Each call therefore costs up to 1000 document reads plus one
 * category list (<= 200) and a handful of inventory reads; a cache is deferred. When the read
 * hits the cap a warning with the organization id is logged and products beyond the first 1000
 * (by name) are not searchable. Scope is filtered in memory. Semantic search arrives with RAG.
 *
 * MATCHING. Text (query, name, SKU, category name, specification values) is NFKC-normalised,
 * lower-cased, stripped of invisible format characters and split on anything that is not a letter,
 * digit or combining mark (so Bangla words stay whole). A product is a result when AT LEAST ONE
 * query token matches a field token: forward when the field token starts with the query token,
 * and (tokens of 3+ characters) reverse when the query token starts with the field token, which
 * covers plurals and inflections ("shirts" ~ "shirt", Bangla "-er" endings) at a small penalty.
 * Query tokens of 1-2 characters count only when they EQUAL a field token (no prefix match in
 * either direction), so "xl" matches a size "xl" but not "xlarge", and "a" or "do" do not pile
 * up matches on unrelated words. Filler words are also dropped from scoring (unless the query is
 * only filler): English do, you, have, has, a, an, the, for, my, me, i, is, are, any, some,
 * please, want, need, show; Banglish ache, ase, ki, chai, dao, den, koto; and the Bangla-script
 * words for "is there", "what", "want", "give" and "how much" (see STOPWORDS).
 * Ranking: more matched tokens first, then the field weights (name > SKU > category name >
 * specification values), then the product name, then id. No match is an empty list, not an error.
 * There is no transliteration: Bangla and English spellings are different tokens.
 */
import "server-only";

import { z } from "zod";

import { adminDb } from "@/lib/firebase/admin";
import { formatMoneyMinor } from "@/lib/format";
import { logger } from "@/lib/logger";
import { PRODUCTS, productRepo, type ProductDoc } from "@/repositories/products";
import { listCategories } from "@/services/products/categories";

import {
  isProductInScope,
  readAvailable,
  retailMinor,
  stockStatusOf,
  stockUnitIds,
  unitKey,
  type StockStatus,
} from "./catalog-access";
import { defineTool, toolFailure, type ToolContext, type ToolOutcome } from "./types";

export const SEARCH_READ_LIMIT = 1000;
export const SEARCH_MAX_RESULTS = 5;
const MAX_QUERY_TOKENS = 10;

/** NFKC + lower-case + split on non letter/digit/mark. Invisible format characters are removed. */
export function tokenize(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\p{Cf}/gu, "")
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((t) => t.length > 0);
}

/** Filler words ignored when scoring (see the header). Bangla entries are written as escapes. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "do",
  "you",
  "have",
  "has",
  "a",
  "an",
  "the",
  "for",
  "my",
  "me",
  "i",
  "is",
  "are",
  "any",
  "some",
  "please",
  "want",
  "need",
  "show",
  "ache",
  "ase",
  "ki",
  "chai",
  "dao",
  "den",
  "koto",
  "\u0986\u099b\u09c7",
  "\u0995\u09bf",
  "\u099a\u09be\u0987",
  "\u09a6\u09bf\u09a8",
  "\u0995\u09a4",
]);
/** Query tokens up to this length must equal a field token. */
const MAX_EXACT_ONLY_LENGTH = 2;

const WEIGHTS = { name: 40, sku: 30, category: 20, spec: 10 } as const;
const EXACT_BONUS = 5;
const REVERSE_PENALTY = 3;
const MIN_REVERSE_LENGTH = 3;
/** One matched token is worth more than any possible field-weight total (10 * 45 = 450). */
const MATCH_UNIT = 1000;

export interface FieldTokens {
  name: readonly string[];
  sku: readonly string[];
  category: readonly string[];
  spec: readonly string[];
}

/**
 * 0 when no query token matches anything, else `matchedTokens * 1000 + summed best field scores`,
 * so the matched-token count dominates and field weights break ties.
 */
export function scoreFields(queryTokens: readonly string[], fields: FieldTokens): number {
  const meaningful = queryTokens.filter((q) => !STOPWORDS.has(q));
  const tokens = meaningful.length > 0 ? meaningful : queryTokens;
  let matched = 0;
  let weights = 0;
  for (const q of tokens) {
    let best = 0;
    for (const key of ["name", "sku", "category", "spec"] as const) {
      for (const t of fields[key]) {
        let score = 0;
        if (q.length <= MAX_EXACT_ONLY_LENGTH) {
          if (t === q) score = WEIGHTS[key] + EXACT_BONUS;
        } else if (t.startsWith(q)) score = WEIGHTS[key] + (t === q ? EXACT_BONUS : 0);
        else if (t.length >= MIN_REVERSE_LENGTH && q.startsWith(t)) {
          score = WEIGHTS[key] - REVERSE_PENALTY;
        }
        best = Math.max(best, score);
      }
    }
    if (best > 0) {
      matched += 1;
      weights += best;
    }
  }
  return matched * MATCH_UNIT + weights;
}

const inputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe("A few short keywords: product name, SKU, category or a specification value."),
  categoryId: z.string().min(1).max(200).optional().describe("Only search this category."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(SEARCH_MAX_RESULTS)
    .default(SEARCH_MAX_RESULTS)
    .describe("How many results to return (1-5)."),
});
type SearchInput = z.output<typeof inputSchema>;

const outputSchema = z.object({
  results: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      sku: z.string(),
      priceText: z.string(),
      stockStatus: z.enum(["in_stock", "low", "out_of_stock"]),
    }),
  ),
});
type SearchOutput = z.output<typeof outputSchema>;

async function run(ctx: ToolContext, input: SearchInput): Promise<ToolOutcome<SearchOutput>> {
  const queryTokens = [...new Set(tokenize(input.query))].slice(0, MAX_QUERY_TOKENS);
  if (queryTokens.length === 0) return toolFailure("invalid");

  const orgId = ctx.organizationId;
  const [snap, categories] = await Promise.all([
    adminDb()
      .collection(PRODUCTS)
      .where("organizationId", "==", orgId)
      .where("archived", "==", false)
      .where("availability", "==", "active")
      .orderBy("nameLower")
      .limit(SEARCH_READ_LIMIT)
      .get(),
    listCategories({ organizationId: orgId, uid: ctx.actorUid }),
  ]);
  if (snap.size >= SEARCH_READ_LIMIT) {
    logger.warn("agent product search hit the read cap", { organizationId: orgId });
  }
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const scored: Array<{ doc: ProductDoc; score: number }> = [];
  for (const d of snap.docs) {
    const doc = productRepo.fromSnapshot(d, orgId);
    if (!doc || doc.availability !== "active" || !isProductInScope(ctx.agent, doc)) continue;
    if (input.categoryId !== undefined && doc.categoryId !== input.categoryId) continue;
    const score = scoreFields(queryTokens, {
      name: tokenize(doc.name),
      sku: tokenize(doc.sku),
      category: doc.categoryId ? tokenize(categoryName.get(doc.categoryId) ?? "") : [],
      spec: Object.values(doc.specifications ?? {}).flatMap((v) =>
        typeof v === "string" ? tokenize(v) : [],
      ),
    });
    if (score > 0) scored.push({ doc, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.doc.nameLower < b.doc.nameLower ? -1 : a.doc.nameLower > b.doc.nameLower ? 1 : 0) ||
      (a.doc.id < b.doc.id ? -1 : 1),
  );
  const top = scored.slice(0, input.limit).map((s) => s.doc);

  const available = await readAvailable(
    ctx,
    top.flatMap((p) => stockUnitIds(p).map((variantId) => ({ productId: p.id, variantId }))),
  );
  const results = top.map((p) => {
    const total = stockUnitIds(p).reduce(
      (sum, variantId) => sum + (available.get(unitKey({ productId: p.id, variantId })) ?? 0),
      0,
    );
    const stockStatus: StockStatus = stockStatusOf(total);
    return {
      productId: p.id,
      name: p.name,
      sku: p.sku,
      priceText: formatMoneyMinor(retailMinor(p)),
      stockStatus,
    };
  });
  return { ok: true, data: { results } };
}

export const searchProductsTool = defineTool<SearchInput, SearchOutput>({
  name: "search_products",
  description:
    "Search the product catalog by a few short keywords (name, SKU, category or specification " +
    "value), not whole sentences. Returns up to 5 products with price text and stock status, " +
    "best match first; a product matches when any keyword matches. Try both Bangla and English " +
    "spellings, because words are not transliterated. An empty list means nothing matched. " +
    "Use this before recommending or quoting any product.",
  input: inputSchema,
  output: outputSchema,
  writes: false,
  run,
});
