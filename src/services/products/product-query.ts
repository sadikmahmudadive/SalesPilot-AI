/**
 * Pure helpers that turn a product list request into a repository query. No I/O and no
 * server-only imports, so every rule here is unit tested without Firestore.
 *
 * Rules (enforced in `buildListPlan`):
 *  - the query ALWAYS carries `archived == <false by default | true when archived=true>`;
 *  - at most ONE of {availability, categoryId} per request (each combination needs its own
 *    composite index, see product-indexes.ts);
 *  - `q` (name prefix on `nameLower`) and `sku` (prefix on `skuLower`) cannot be combined with a
 *    filter or with each other, and force their own order (ascending on the searched field),
 *    ignoring `sort` / `dir`;
 *  - sorts: createdAt, name (-> nameLower), updatedAt; limit defaults to 25, maximum 50.
 *
 * Source hygiene: no literal non-ASCII characters in this file.
 */
import { z } from "zod";

import { isValidIdSegment } from "@/lib/ids";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_SEARCH_LENGTH,
  cursorParam,
  limitParam,
  optionalParam,
  parseQueryParams,
  resolveListLimit,
  staticInvalid as invalid,
} from "@/lib/list-params";
import { PREFIX_END, hasLoneSurrogate, sortKey } from "@/lib/text";
import type { WhereClause } from "@/repositories/base";
import { AVAILABILITIES, type Availability } from "@/schemas/product";

export { DEFAULT_LIMIT, MAX_LIMIT, MAX_SEARCH_LENGTH };

export type SortName = "createdAt" | "name" | "updatedAt";
export type SortDir = "asc" | "desc";
export type OrderField = "createdAt" | "nameLower" | "updatedAt" | "skuLower";
export type FilterField = "availability" | "categoryId";

export const SORT_FIELDS: Readonly<Record<SortName, Exclude<OrderField, "skuLower">>> = {
  createdAt: "createdAt",
  name: "nameLower",
  updatedAt: "updatedAt",
};

export interface ProductListQuery {
  /** Name prefix search. */
  q?: string;
  /** SKU prefix search. */
  sku?: string;
  availability?: Availability;
  categoryId?: string;
  /** Default false: archived products are hidden unless asked for. */
  archived?: boolean;
  sort: SortName;
  dir: SortDir;
  limit?: number;
  cursor?: string;
}

/** The index-relevant shape of a query: which filter (if any) and which order. */
export interface QueryShape {
  filterField?: FilterField;
  orderField: OrderField;
  direction: SortDir;
}

export interface ListPlan {
  where: WhereClause[];
  orderBy: [field: OrderField, dir: SortDir];
  limit: number;
  cursor?: string;
  shape: QueryShape;
}

/** The stored name sort/search key (see `sortKey`); queries go through the same function. */
export const nameLowerKey = sortKey;

/** The stored SKU search key. SKUs are ASCII (upper-cased on write), so this is plain lower-casing. */
export const skuLowerKey = (sku: string): string => sku.toLowerCase();

const SKU_SEARCH = /^[a-z0-9._-]+$/;

export interface SearchPlan {
  field: "nameLower" | "skuLower";
  start: string;
  end: string;
}

function planNameSearch(raw: string): SearchPlan {
  if (raw.length > MAX_SEARCH_LENGTH)
    throw invalid("q", `Search must be ${MAX_SEARCH_LENGTH} characters or fewer`);
  if (hasLoneSurrogate(raw)) throw invalid("q", "Invalid search text");
  const start = nameLowerKey(raw);
  return { field: "nameLower", start, end: start + PREFIX_END };
}

function planSkuSearch(raw: string): SearchPlan {
  if (raw.length > MAX_SEARCH_LENGTH)
    throw invalid("sku", `Search must be ${MAX_SEARCH_LENGTH} characters or fewer`);
  const start = skuLowerKey(raw);
  if (!SKU_SEARCH.test(start)) throw invalid("sku", "Invalid SKU search");
  return { field: "skuLower", start, end: start + PREFIX_END };
}

const enumHas = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && list.includes(v as T);

/** Validates a list request and produces the repository query plus its index shape. */
export function buildListPlan(q: ProductListQuery): ListPlan {
  const limit = resolveListLimit(q.limit, { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT });
  if (!Object.hasOwn(SORT_FIELDS, q.sort)) throw invalid("sort", "Invalid sort");
  if (q.dir !== "asc" && q.dir !== "desc")
    throw invalid("dir", "Sort direction must be asc or desc");
  if (q.archived !== undefined && typeof q.archived !== "boolean")
    throw invalid("archived", "Invalid value");
  if (q.availability !== undefined && !enumHas(AVAILABILITIES, q.availability)) {
    throw invalid("availability", "Invalid availability");
  }
  if (q.categoryId !== undefined && !isValidIdSegment(q.categoryId)) {
    throw invalid("categoryId", "Invalid category");
  }
  if (q.q !== undefined && typeof q.q !== "string") throw invalid("q", "Invalid search text");
  if (q.sku !== undefined && typeof q.sku !== "string") throw invalid("sku", "Invalid SKU search");

  const archived: WhereClause = ["archived", "==", q.archived ?? false];

  const filters: WhereClause[] = [];
  if (q.availability !== undefined) filters.push(["availability", "==", q.availability]);
  if (q.categoryId !== undefined) filters.push(["categoryId", "==", q.categoryId]);
  if (filters.length > 1) throw invalid("filter", "Use only one filter at a time");

  const name = q.q?.trim() ?? "";
  const sku = q.sku?.trim() ?? "";
  if (name.length > 0 && sku.length > 0) throw invalid("q", "Search by name or SKU, not both");
  if ((name.length > 0 || sku.length > 0) && filters.length > 0) {
    throw invalid(name.length > 0 ? "q" : "sku", "Search cannot be combined with a filter");
  }
  if (name.length > 0 || sku.length > 0) {
    const plan = name.length > 0 ? planNameSearch(name) : planSkuSearch(sku);
    return {
      where: [archived, [plan.field, ">=", plan.start], [plan.field, "<", plan.end]],
      orderBy: [plan.field, "asc"],
      limit,
      cursor: q.cursor,
      shape: { orderField: plan.field, direction: "asc" },
    };
  }

  const orderField = SORT_FIELDS[q.sort];
  const filter = filters[0];
  return {
    where: [archived, ...filters],
    orderBy: [orderField, q.dir],
    limit,
    cursor: q.cursor,
    shape: { filterField: filter?.[0] as FilterField | undefined, orderField, direction: q.dir },
  };
}

// ---- HTTP query-string parsing ---------------------------------------------------------

const listParamsSchema = z.object({
  q: optionalParam(z.string().max(MAX_SEARCH_LENGTH)),
  sku: optionalParam(z.string().max(MAX_SEARCH_LENGTH)),
  availability: optionalParam(z.enum(AVAILABILITIES)),
  categoryId: optionalParam(z.string().refine((v) => isValidIdSegment(v))),
  archived: optionalParam(z.enum(["true", "false"])),
  sort: optionalParam(z.enum(["createdAt", "name", "updatedAt"])),
  dir: optionalParam(z.enum(["asc", "desc"])),
  limit: limitParam(MAX_LIMIT),
  cursor: cursorParam(),
});

/**
 * Parses `?q&sku&availability&categoryId&archived&sort&dir&limit&cursor`. Unknown params are
 * ignored; repeated params and invalid values are a ValidationError carrying only param names
 * and static messages. Empty values count as absent.
 */
export function parseListParams(params: URLSearchParams): ProductListQuery {
  const p = parseQueryParams(params, listParamsSchema);
  const sort = p.sort ?? "createdAt";
  const out: ProductListQuery = { sort, dir: p.dir ?? (sort === "name" ? "asc" : "desc") };
  if (p.q !== undefined) out.q = p.q;
  if (p.sku !== undefined) out.sku = p.sku;
  if (p.availability !== undefined) out.availability = p.availability;
  if (p.categoryId !== undefined) out.categoryId = p.categoryId;
  if (p.archived !== undefined) out.archived = p.archived === "true";
  if (p.limit !== undefined) out.limit = p.limit;
  if (p.cursor !== undefined) out.cursor = p.cursor;
  return out;
}
