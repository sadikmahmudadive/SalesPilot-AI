/**
 * `search_products`: keyword search over the organization's catalog, limited to what the agent
 * may see. Server-only.
 *
 * READ BOUND. At most 1000 non-archived products of the organization are read (one query ordered
 * by `nameLower`, served by the existing (organizationId, archived, nameLower) index); the rest
 * is filtered in memory (`active` and in scope). Semantic search arrives with RAG.
 *
 * MATCHING. Text (query, name, SKU, category name, specification values) is NFKC-normalised,
 * lower-cased, stripped of invisible format characters and split on anything that is not a letter,
 * digit or combining mark (so Bangla words stay whole). EVERY query token must match the START of
 * some field token (exact matches score higher), otherwise the product is not a result: "lal
 * shirt" finds nothing unless something is both "lal" and "shirt". A token scores by the best
 * field it matches: name > SKU > category name > specification values. Ties go to the name.
 */
import "server-only";

import { z } from "zod";

import { adminDb } from "@/lib/firebase/admin";
import { formatMoneyMinor } from "@/lib/format";
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

const WEIGHTS = { name: 40, sku: 30, category: 20, spec: 10 } as const;
const EXACT_BONUS = 5;

/** NFKC + lower-case + split on non letter/digit/mark. Invisible format characters are removed. */
export function tokenize(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\p{Cf}/gu, "")
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((t) => t.length > 0);
}

export interface FieldTokens {
  name: readonly string[];
  sku: readonly string[];
  category: readonly string[];
  spec: readonly string[];
}

/** 0 when any query token matches nothing (or there are no tokens), else the summed best scores. */
export function scoreFields(queryTokens: readonly string[], fields: FieldTokens): number {
  if (queryTokens.length === 0) return 0;
  let total = 0;
  for (const q of queryTokens) {
    let best = 0;
    for (const key of ["name", "sku", "category", "spec"] as const) {
      for (const t of fields[key]) {
        if (!t.startsWith(q)) continue;
        best = Math.max(best, WEIGHTS[key] + (t === q ? EXACT_BONUS : 0));
      }
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

const inputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe("Keywords: product name, SKU, category or a specification value."),
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
      availability: z.string(),
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
      .orderBy("nameLower")
      .limit(SEARCH_READ_LIMIT)
      .get(),
    listCategories({ organizationId: orgId, uid: ctx.actorUid }),
  ]);
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
      availability: p.availability as string,
      stockStatus,
    };
  });
  return { ok: true, data: { results } };
}

export const searchProductsTool = defineTool<SearchInput, SearchOutput>({
  name: "search_products",
  description:
    "Search the product catalog by keywords (name, SKU, category or specification value). " +
    "Returns up to 5 matching products with price text and stock status. Every keyword must " +
    "match. Use this before recommending or quoting any product; an empty list means nothing " +
    "matched.",
  input: inputSchema,
  output: outputSchema,
  writes: false,
  run,
});
