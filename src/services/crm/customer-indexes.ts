/**
 * Composite indexes required by `listCustomers`, as a typed table. Pure data, no I/O.
 *
 * Every list query is `where organizationId == org [AND one filter] [AND prefix range]
 * ORDER BY <field> <dir>, __name__ <dir>`. The Firestore emulator does NOT enforce indexes, so
 * a missing entry only fails in production (FAILED_PRECONDITION). This table is the safety
 * net: `customer-indexes.test.ts` asserts that
 *   - every entry is present in firestore.indexes.json (exact Firebase format),
 *   - firestore.indexes.json holds no other `customers` index,
 *   - every query the service can build (see `buildListPlan`) is served by an entry with the
 *     SAME order direction.
 * Adding a filter or sort to the service means adding it here AND to the JSON.
 *
 * DIRECTION: we do not rely on Firestore serving a descending query from an ascending index
 * by reverse scan (it cannot be proven with the emulator). Every (filter, order field) pair
 * the service can issue gets BOTH an ASCENDING and a DESCENDING index, each with `__name__` in
 * the same direction as the order field (the tie-break `list()` uses). Only the phone prefix
 * search, which is always ascending, has a single ASCENDING entry. The unfiltered name index
 * (fullNameLower ASC) also serves the name prefix search (range on the ordered field).
 * Production verification requires `firebase deploy --only firestore:indexes`.
 *
 * The tag filter uses the lower-cased `tagsLower` array (array-contains), not `tags`.
 */
import type { QueryShape } from "./customer-query";

export type IndexEqualityField = "segment" | "customerType" | "assignedAgentId";
export type IndexDirection = "ASCENDING" | "DESCENDING";

export interface CustomerIndexSpec {
  /** Equality filter field (ASCENDING in the index; direction is irrelevant for equality). */
  equalityField?: IndexEqualityField;
  /** Array-contains filter field. */
  arrayContainsField?: "tagsLower";
  /** Field the query orders by (and, for search, applies the prefix range to). */
  orderField: "createdAt" | "fullNameLower" | "lastInteractionAt" | "phoneE164";
  /** Direction of the order field and of `__name__` in the index. */
  direction: IndexDirection;
  note: string;
}

const SORT_FIELDS = ["createdAt", "fullNameLower", "lastInteractionAt"] as const;
const DIRECTIONS: readonly IndexDirection[] = ["ASCENDING", "DESCENDING"];
const EQUALITY_FIELDS: readonly IndexEqualityField[] = [
  "segment",
  "customerType",
  "assignedAgentId",
];

const dirWord = (d: IndexDirection) => (d === "ASCENDING" ? "ascending" : "descending");

const base = SORT_FIELDS.flatMap((orderField) =>
  DIRECTIONS.map<CustomerIndexSpec>((direction) => ({
    orderField,
    direction,
    note:
      orderField === "fullNameLower" && direction === "ASCENDING"
        ? "Unfiltered list sorted by name ascending, and the name prefix search."
        : `Unfiltered list sorted by ${orderField} ${dirWord(direction)}.`,
  })),
);

const equality = EQUALITY_FIELDS.flatMap((equalityField) =>
  SORT_FIELDS.flatMap((orderField) =>
    DIRECTIONS.map<CustomerIndexSpec>((direction) => ({
      equalityField,
      orderField,
      direction,
      note: `List filtered by ${equalityField}, sorted by ${orderField} ${dirWord(direction)}.`,
    })),
  ),
);

const tags = SORT_FIELDS.flatMap((orderField) =>
  DIRECTIONS.map<CustomerIndexSpec>((direction) => ({
    arrayContainsField: "tagsLower",
    orderField,
    direction,
    note: `List filtered by tag (array-contains on tagsLower), sorted by ${orderField} ${dirWord(direction)}.`,
  })),
);

const phoneSearch: CustomerIndexSpec = {
  orderField: "phoneE164",
  direction: "ASCENDING",
  note: "Phone prefix search: range on phoneE164, ordered by phoneE164 ascending.",
};

export const CUSTOMER_LIST_INDEXES: readonly CustomerIndexSpec[] = [
  ...base,
  ...equality,
  ...tags,
  phoneSearch,
];

export interface FirestoreIndexField {
  fieldPath: string;
  order?: "ASCENDING" | "DESCENDING";
  arrayConfig?: "CONTAINS";
}
export interface FirestoreIndex {
  collectionGroup: "customers";
  queryScope: "COLLECTION";
  fields: FirestoreIndexField[];
}

/** The entry exactly as it must appear in firestore.indexes.json (key order included). */
export function toFirestoreIndex(spec: CustomerIndexSpec): FirestoreIndex {
  const fields: FirestoreIndexField[] = [{ fieldPath: "organizationId", order: "ASCENDING" }];
  if (spec.equalityField) fields.push({ fieldPath: spec.equalityField, order: "ASCENDING" });
  if (spec.arrayContainsField)
    fields.push({ fieldPath: spec.arrayContainsField, arrayConfig: "CONTAINS" });
  fields.push({ fieldPath: spec.orderField, order: spec.direction });
  fields.push({ fieldPath: "__name__", order: spec.direction });
  return { collectionGroup: "customers", queryScope: "COLLECTION", fields };
}

/** The table entry that serves a query shape: same filter, order field AND direction. */
export function indexServing(shape: QueryShape): CustomerIndexSpec | undefined {
  const direction: IndexDirection = shape.direction === "asc" ? "ASCENDING" : "DESCENDING";
  return CUSTOMER_LIST_INDEXES.find((spec) => {
    const filter = spec.equalityField ?? spec.arrayContainsField;
    return (
      filter === shape.filterField &&
      spec.orderField === shape.orderField &&
      spec.direction === direction
    );
  });
}
