/** Pure mapping from the list screen's controls to API query parameters. */
import type { CustomerListParams } from "@/hooks/use-customers";
import type { CustomerSegment, CustomerType } from "@/schemas/customer";

export const PAGE_SIZE = 25;
export const MIN_SEARCH_LENGTH = 2;
/** Matches the backend limit on `q`. */
export const MAX_SEARCH_LENGTH = 64;

export type FilterBy = "none" | "segment" | "customerType" | "tag";
export type SortKey = "newest" | "name-asc" | "name-desc" | "recent";

export interface ListFilterState {
  search: string;
  filterBy: FilterBy;
  segment: CustomerSegment | "";
  customerType: CustomerType | "";
  tag: string;
  sortKey: SortKey;
}

export const DEFAULT_FILTERS: ListFilterState = {
  search: "",
  filterBy: "none",
  segment: "",
  customerType: "",
  tag: "",
  sortKey: "newest",
};

export const SORT_OPTIONS: readonly {
  key: SortKey;
  label: string;
  sort: NonNullable<CustomerListParams["sort"]>;
  dir: "asc" | "desc";
}[] = [
  { key: "newest", label: "Newest", sort: "createdAt", dir: "desc" },
  { key: "name-asc", label: "Name A-Z", sort: "fullName", dir: "asc" },
  { key: "name-desc", label: "Name Z-A", sort: "fullName", dir: "desc" },
  { key: "recent", label: "Recently active", sort: "lastInteractionAt", dir: "desc" },
];

/** A search only runs once it has enough characters. */
export function isSearchActive(search: string): boolean {
  return search.trim().length >= MIN_SEARCH_LENGTH;
}

export function toListParams(state: ListFilterState): Omit<CustomerListParams, "cursor"> {
  const option = SORT_OPTIONS.find((o) => o.key === state.sortKey) ?? SORT_OPTIONS[0]!;
  const params: Omit<CustomerListParams, "cursor"> = {
    sort: option.sort,
    dir: option.dir,
    limit: PAGE_SIZE,
  };

  if (isSearchActive(state.search)) {
    params.q = state.search.trim();
    return params;
  }
  if (state.filterBy === "segment" && state.segment) params.segment = state.segment;
  else if (state.filterBy === "customerType" && state.customerType) params.customerType = state.customerType;
  else if (state.filterBy === "tag" && state.tag.trim()) params.tag = state.tag.trim();
  return params;
}

/** True when a search or a chosen filter value is narrowing the list (sorting does not count). */
export function hasActiveCriteria(state: ListFilterState): boolean {
  const { q, ...rest } = toListParams(state);
  return q !== undefined || rest.segment !== undefined || rest.customerType !== undefined || rest.tag !== undefined;
}
