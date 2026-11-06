/** List-screen constants and rules shared by every searchable list (customers, products). Pure. */

export const PAGE_SIZE = 25;
export const MIN_SEARCH_LENGTH = 2;
/** Matches the backend limit on search text. */
export const MAX_SEARCH_LENGTH = 64;

/** A search only runs once it has enough characters. */
export function isSearchActive(search: string): boolean {
  return search.trim().length >= MIN_SEARCH_LENGTH;
}

/** "1 customer" / "2 customers". */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
