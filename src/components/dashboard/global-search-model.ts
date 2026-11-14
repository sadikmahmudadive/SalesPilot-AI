/**
 * Pure helpers for the header search dropdown (shape of `GET /api/search`).
 */
export type SearchGroup = "customers" | "products" | "orders" | "conversations";

export interface SearchHitView {
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

/** A group the role cannot read is null; a group with no matches is []. */
export type SearchResultsView = Record<SearchGroup, SearchHitView[] | null>;

export const SEARCH_GROUPS: readonly SearchGroup[] = [
  "customers",
  "products",
  "orders",
  "conversations",
];

export const SEARCH_GROUP_LABELS: Readonly<Record<SearchGroup, string>> = {
  customers: "Customers",
  products: "Products",
  orders: "Orders",
  conversations: "Conversations",
};

export const MIN_QUERY_LENGTH = 2;

/** Every hit in display order, so the keyboard can move through them as one list. */
export function flattenHits(
  results: SearchResultsView | undefined,
): Array<{ group: SearchGroup; hit: SearchHitView }> {
  if (!results) return [];
  return SEARCH_GROUPS.flatMap((group) => (results[group] ?? []).map((hit) => ({ group, hit })));
}

/** The next highlighted index, wrapping at both ends; -1 when there is nothing to highlight. */
export function moveIndex(index: number, delta: 1 | -1, length: number): number {
  if (length <= 0) return -1;
  if (index < 0) return delta === 1 ? 0 : length - 1;
  return (index + delta + length) % length;
}

const LIST_PATH: Readonly<Record<SearchGroup, string>> = {
  customers: "/customers",
  products: "/products",
  orders: "/orders",
  conversations: "/inbox",
};

/** The full list for a group, opened with the same search. */
export function seeAllHref(group: SearchGroup, query: string): string {
  return `${LIST_PATH[group]}?q=${encodeURIComponent(query.trim())}`;
}
