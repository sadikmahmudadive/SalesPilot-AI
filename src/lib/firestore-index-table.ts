/**
 * Shared types and helpers for the typed composite-index tables (customer-indexes.ts,
 * product-indexes.ts, inventory-indexes.ts) that mirror firestore.indexes.json. Pure.
 */

export type IndexDirection = "ASCENDING" | "DESCENDING";

export const INDEX_DIRECTIONS: readonly IndexDirection[] = ["ASCENDING", "DESCENDING"];

export const directionWord = (d: IndexDirection): "ascending" | "descending" =>
  d === "ASCENDING" ? "ascending" : "descending";

/** One field of an index: ordered (`order`) or an array-contains field (`arrayConfig`). */
export interface FirestoreIndexField {
  fieldPath: string;
  order?: IndexDirection;
  arrayConfig?: "CONTAINS";
}

export interface FirestoreIndex {
  collectionGroup: string;
  queryScope: "COLLECTION";
  fields: FirestoreIndexField[];
}

/**
 * Canonical text of an index as Firestore sees it. A trailing `__name__` that has the same
 * direction as the field before it (ASCENDING after an array-contains field) is implicit, so an
 * index with and without it is the SAME index and deploying both fails; it is dropped here.
 */
export function normalizedIndexKey(index: FirestoreIndex): string {
  const fields = [...index.fields];
  const last = fields.at(-1);
  const prev = fields.at(-2);
  if (last?.fieldPath === "__name__" && prev && last.order === (prev.order ?? "ASCENDING")) {
    fields.pop();
  }
  return JSON.stringify([index.collectionGroup, index.queryScope, fields]);
}
