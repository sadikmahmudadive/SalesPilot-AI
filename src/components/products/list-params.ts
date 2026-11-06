/** Pure mapping from the product list's controls to API query parameters. */
import type { ProductListParams } from "@/hooks/use-products";
import { MIN_SEARCH_LENGTH, PAGE_SIZE } from "@/lib/list-ui";
import type { Availability } from "@/schemas/product";

export type SearchMode = "name" | "sku";
export type FilterBy = "none" | "availability" | "category";
export type SortKey = "newest" | "name-asc" | "name-desc" | "updated";

export interface ProductFilterState {
  search: string;
  searchMode: SearchMode;
  filterBy: FilterBy;
  /** Only live availabilities: archived products have their own toggle. */
  availability: Exclude<Availability, "archived"> | "";
  categoryId: string;
  archived: boolean;
  sortKey: SortKey;
}

export const DEFAULT_FILTERS: ProductFilterState = {
  search: "",
  searchMode: "name",
  filterBy: "none",
  availability: "",
  categoryId: "",
  archived: false,
  sortKey: "newest",
};

export const SORT_OPTIONS: readonly {
  key: SortKey;
  label: string;
  sort: NonNullable<ProductListParams["sort"]>;
  dir: "asc" | "desc";
}[] = [
  { key: "newest", label: "Newest", sort: "createdAt", dir: "desc" },
  { key: "name-asc", label: "Name A-Z", sort: "name", dir: "asc" },
  { key: "name-desc", label: "Name Z-A", sort: "name", dir: "desc" },
  { key: "updated", label: "Recently updated", sort: "updatedAt", dir: "desc" },
];

/** SKUs only contain these characters; the API answers 400 to a SKU search that has anything else. */
const SKU_DISALLOWED = /[^A-Za-z0-9._-]/g;

/**
 * The text that is actually searched for, or "" when there is nothing to search yet: trimmed, and
 * for a SKU search stripped of characters a SKU cannot contain (so a stray space never reaches the
 * API), and at least `MIN_SEARCH_LENGTH` long.
 */
export function searchTerm(state: Pick<ProductFilterState, "search" | "searchMode">): string {
  const trimmed = state.search.trim();
  const term = state.searchMode === "sku" ? trimmed.replace(SKU_DISALLOWED, "") : trimmed;
  return term.length >= MIN_SEARCH_LENGTH ? term : "";
}

export function toListParams(state: ProductFilterState): Omit<ProductListParams, "cursor"> {
  const option = SORT_OPTIONS.find((o) => o.key === state.sortKey) ?? SORT_OPTIONS[0]!;
  const params: Omit<ProductListParams, "cursor"> = {
    sort: option.sort,
    dir: option.dir,
    limit: PAGE_SIZE,
    archived: state.archived,
  };

  const term = searchTerm(state);
  if (term) {
    if (state.searchMode === "sku") params.sku = term;
    else params.q = term;
    return params;
  }
  // Archived products all have the "archived" availability, so that filter cannot apply to them.
  if (state.filterBy === "availability" && state.availability && !state.archived) {
    params.availability = state.availability;
  } else if (state.filterBy === "category" && state.categoryId) {
    params.categoryId = state.categoryId;
  }
  return params;
}

/** True when a search, a chosen filter value or the archived view is narrowing the list (sorting does not count). */
export function hasActiveCriteria(state: ProductFilterState): boolean {
  const p = toListParams(state);
  return (
    p.q !== undefined ||
    p.sku !== undefined ||
    p.availability !== undefined ||
    p.categoryId !== undefined ||
    p.archived === true
  );
}
