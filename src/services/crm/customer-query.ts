/**
 * Pure helpers that turn a customer list request into a repository query. No I/O, no
 * server-only imports, so every rule here is unit tested without Firestore.
 *
 * Rules (enforced in `buildListPlan`):
 *  - at most ONE of {segment, customerType, tag, assignedAgentId} per request, because each
 *    combination needs its own composite index (see customer-indexes.ts);
 *  - `search` cannot be combined with a filter and forces its own order (prefix range on the
 *    sorted field, ascending), ignoring `sort` / `dir`;
 *  - search is a phone prefix search when the query is only digits/phone punctuation with at
 *    least 3 digits, otherwise a name prefix search on `fullNameLower`;
 *  - limit defaults to 25, maximum 50.
 *
 * Source hygiene: this file must stay free of literal non-ASCII characters and `\uXXXX`
 * escapes (the editing tools decode escapes into raw characters), so code points are built
 * with String.fromCharCode / fromCodePoint.
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
  staticInvalid as invalid,
} from "@/lib/list-params";
import { cleanPhoneInput } from "@/lib/phone";
import { tagKey } from "@/lib/tags";
import { PREFIX_END, hasLoneSurrogate, sortKey } from "@/lib/text";
import type { WhereClause } from "@/repositories/base";
import {
  CUSTOMER_SEGMENTS,
  CUSTOMER_TYPES,
  type CustomerSegment,
  type CustomerType,
} from "@/schemas/customer";

export { DEFAULT_LIMIT, MAX_LIMIT, MAX_SEARCH_LENGTH };
const MIN_PHONE_DIGITS = 3;
const MAX_TAG_FILTER_LENGTH = 80;

export type SortName = "createdAt" | "fullName" | "lastInteractionAt";
export type SortDir = "asc" | "desc";
export type OrderField = "createdAt" | "fullNameLower" | "lastInteractionAt" | "phoneE164";
export type FilterField = "segment" | "customerType" | "assignedAgentId" | "tagsLower";

export const SORT_FIELDS: Readonly<Record<SortName, OrderField>> = {
  createdAt: "createdAt",
  fullName: "fullNameLower",
  lastInteractionAt: "lastInteractionAt",
};

export interface CustomerListQuery {
  search?: string;
  segment?: CustomerSegment;
  customerType?: CustomerType;
  tag?: string;
  assignedAgentId?: string;
  sort: SortName;
  dir: SortDir;
  limit?: number;
  cursor?: string;
}

/** The index-relevant shape of a query: which filter (if any) and which order. */
export interface QueryShape {
  filterField?: string;
  orderField: string;
  direction: SortDir;
}

export interface ListPlan {
  where: WhereClause[];
  orderBy: [field: OrderField, dir: SortDir];
  limit: number;
  cursor?: string;
  shape: QueryShape;
}

/**
 * Case-insensitive tag key: NFKC, trimmed, lower-cased. Stored (de-duplicated) in `tagsLower`
 * and used, normalised the same way, for the tag filter, so `VIP`, `vip` and ` vip ` all match.
 */
export { tagKey };

export function tagKeys(tags: readonly string[]): string[] {
  return [...new Set(tags.map(tagKey).filter((t) => t.length > 0))];
}

/**
 * The stored sort/search key for a customer name (see `sortKey`). The search query goes
 * through the same function so both sides always agree.
 */
export const fullNameLowerKey = sortKey;

export { PREFIX_END };

export type SearchPlan =
  | { kind: "phone"; field: "phoneE164"; start: string; end: string }
  | { kind: "name"; field: "fullNameLower"; start: string; end: string };

/** Normalised E.164-style prefix for digits typed so far. Leading 0 means Bangladesh. */
function phonePrefix(cleaned: string): string {
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("00")) return `+${cleaned.slice(2)}`;
  if (cleaned.startsWith("0")) return `+880${cleaned.slice(1)}`;
  return `+${cleaned}`; // e.g. 8801712...: country code typed without the plus
}

/** Decides phone-vs-name prefix search and computes the half-open range `[start, end)`. */
export function planSearch(raw: string): SearchPlan {
  const query = raw.trim();
  if (query.length > MAX_SEARCH_LENGTH)
    throw invalid("q", `Search must be ${MAX_SEARCH_LENGTH} characters or fewer`);
  if (hasLoneSurrogate(query)) throw invalid("q", "Invalid search text");

  const cleaned = cleanPhoneInput(query); // same cleaning as normalizePhone
  if (/^\+?\d+$/.test(cleaned) && cleaned.replace(/\D/g, "").length >= MIN_PHONE_DIGITS) {
    const start = phonePrefix(cleaned);
    return { kind: "phone", field: "phoneE164", start, end: start + PREFIX_END };
  }
  const start = fullNameLowerKey(query);
  return { kind: "name", field: "fullNameLower", start, end: start + PREFIX_END };
}

const enumHas = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && list.includes(v as T);

/** Validates a list request and produces the repository query plus its index shape. */
export function buildListPlan(q: CustomerListQuery): ListPlan {
  const limit = q.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw invalid("limit", `Limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  if (!Object.hasOwn(SORT_FIELDS, q.sort)) throw invalid("sort", "Invalid sort");
  if (q.dir !== "asc" && q.dir !== "desc")
    throw invalid("dir", "Sort direction must be asc or desc");
  if (q.segment !== undefined && !enumHas(CUSTOMER_SEGMENTS, q.segment))
    throw invalid("segment", "Invalid segment");
  if (q.customerType !== undefined && !enumHas(CUSTOMER_TYPES, q.customerType)) {
    throw invalid("customerType", "Invalid customer type");
  }
  // Tags are at most 40 characters once trimmed; allow padding around them in the filter.
  const tag = q.tag === undefined ? undefined : typeof q.tag === "string" ? tagKey(q.tag) : "";
  if (
    q.tag !== undefined &&
    (typeof q.tag !== "string" ||
      q.tag.length > MAX_TAG_FILTER_LENGTH ||
      hasLoneSurrogate(q.tag) ||
      !tag)
  ) {
    throw invalid("tag", "Invalid tag");
  }
  if (q.assignedAgentId !== undefined && !isValidIdSegment(q.assignedAgentId)) {
    throw invalid("assignedAgentId", "Invalid agent");
  }

  const filters: WhereClause[] = [];
  if (q.segment !== undefined) filters.push(["segment", "==", q.segment]);
  if (q.customerType !== undefined) filters.push(["customerType", "==", q.customerType]);
  if (q.assignedAgentId !== undefined) filters.push(["assignedAgentId", "==", q.assignedAgentId]);
  if (tag) filters.push(["tagsLower", "array-contains", tag]);
  if (filters.length > 1) throw invalid("filter", "Use only one filter at a time");

  const search = typeof q.search === "string" ? q.search.trim() : "";
  if (q.search !== undefined && typeof q.search !== "string")
    throw invalid("q", "Invalid search text");
  if (search.length > 0) {
    if (filters.length > 0) throw invalid("q", "Search cannot be combined with a filter");
    const plan = planSearch(search);
    return {
      where: [
        [plan.field, ">=", plan.start],
        [plan.field, "<", plan.end],
      ],
      orderBy: [plan.field, "asc"],
      limit,
      cursor: q.cursor,
      shape: { orderField: plan.field, direction: "asc" },
    };
  }

  const orderField = SORT_FIELDS[q.sort];
  const filter = filters[0];
  return {
    where: filters,
    orderBy: [orderField, q.dir],
    limit,
    cursor: q.cursor,
    shape: { filterField: filter?.[0], orderField, direction: q.dir },
  };
}

// ---- HTTP query-string parsing ---------------------------------------------------------

const listParamsSchema = z.object({
  q: optionalParam(z.string().max(MAX_SEARCH_LENGTH)),
  segment: optionalParam(z.enum(CUSTOMER_SEGMENTS)),
  customerType: optionalParam(z.enum(CUSTOMER_TYPES)),
  tag: optionalParam(z.string().min(1).max(MAX_TAG_FILTER_LENGTH)),
  assignedAgentId: optionalParam(z.string().refine((v) => isValidIdSegment(v))),
  sort: optionalParam(z.enum(["createdAt", "fullName", "lastInteractionAt"])),
  dir: optionalParam(z.enum(["asc", "desc"])),
  limit: limitParam(MAX_LIMIT),
  cursor: cursorParam(),
});

/**
 * Parses `?q&segment&customerType&tag&assignedAgentId&sort&dir&limit&cursor`. Unknown params
 * are ignored; repeated params and invalid values are a ValidationError carrying only param
 * names and static messages. Empty values count as absent.
 */
export function parseListParams(params: URLSearchParams): CustomerListQuery {
  const p = parseQueryParams(params, listParamsSchema);
  const sort = p.sort ?? "createdAt";
  const out: CustomerListQuery = { sort, dir: p.dir ?? (sort === "fullName" ? "asc" : "desc") };
  if (p.q !== undefined) out.search = p.q;
  if (p.segment !== undefined) out.segment = p.segment;
  if (p.customerType !== undefined) out.customerType = p.customerType;
  if (p.tag !== undefined) out.tag = p.tag;
  if (p.assignedAgentId !== undefined) out.assignedAgentId = p.assignedAgentId;
  if (p.limit !== undefined) out.limit = p.limit;
  if (p.cursor !== undefined) out.cursor = p.cursor;
  return out;
}
