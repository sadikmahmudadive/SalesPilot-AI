/**
 * Composite indexes required by `listCustomers`, as a typed table. Pure data, no I/O.
 *
 * Every list query is `where organizationId == org [AND one filter] [AND prefix range]
 * ORDER BY <field> <dir>, __name__ <dir>`. The Firestore emulator does NOT enforce indexes, so
 * a missing entry only fails in production (FAILED_PRECONDITION). This table is the safety
 * net: `customer-indexes.test.ts` asserts that
 *   - every entry is present in firestore.indexes.json (exact Firebase format),
 *   - firestore.indexes.json holds no other `customers` index,
 *   - every query the service can build (see `buildListPlan`) is served by an entry.
 * Adding a filter or sort to the service means adding a row here AND to the JSON.
 *
 * DIRECTION: an index is scanned forwards or backwards, so one index ordered DESCENDING on the
 * sort field (and DESCENDING on `__name__`, which follows the last order field) serves both
 * `asc` and `dir=desc` queries: `asc` is the exact reverse scan. Equality / array-contains
 * fields have no direction in a query, so they do not need their own variants. We therefore
 * emit ONE index per (filter, order field) combination (`indexServing` ignores direction).
 * This relies on Firestore's reverse-scan behaviour; it can only be proven against a deployed
 * database (`firebase deploy --only firestore:indexes`), not the emulator.
 *
 * Search needs `organizationId + fullNameLower` (served by the base fullNameLower index, the
 * name prefix range is on the ordered field) and `organizationId + phoneE164` (its own entry).
 */
import type { QueryShape } from "./customer-query";

export type IndexEqualityField = "segment" | "customerType" | "assignedAgentId";

export interface CustomerIndexSpec {
  /** Equality filter field (ASCENDING in the index; direction is irrelevant for equality). */
  equalityField?: IndexEqualityField;
  /** Array-contains filter field. */
  arrayContainsField?: "tags";
  /** Field the query orders by (and, for search, applies the prefix range to). */
  orderField: "createdAt" | "fullNameLower" | "lastInteractionAt" | "phoneE164";
  /** Direction of the order field in the index; the reverse query is a backwards scan. */
  direction: "ASCENDING" | "DESCENDING";
  note: string;
}

const SORT_FIELDS = ["createdAt", "fullNameLower", "lastInteractionAt"] as const;
const EQUALITY_FIELDS: readonly IndexEqualityField[] = [
  "segment",
  "customerType",
  "assignedAgentId",
];

const base: CustomerIndexSpec[] = SORT_FIELDS.map((orderField) => ({
  orderField,
  direction: "DESCENDING",
  note:
    orderField === "fullNameLower"
      ? "Unfiltered list sorted by name (asc/desc by reverse scan) and the name prefix search."
      : `Unfiltered list sorted by ${orderField} (asc/desc by reverse scan).`,
}));

const equality: CustomerIndexSpec[] = EQUALITY_FIELDS.flatMap((equalityField) =>
  SORT_FIELDS.map<CustomerIndexSpec>((orderField) => ({
    equalityField,
    orderField,
    direction: "DESCENDING",
    note: `List filtered by ${equalityField}, sorted by ${orderField} (asc/desc by reverse scan).`,
  })),
);

const tags: CustomerIndexSpec[] = SORT_FIELDS.map((orderField) => ({
  arrayContainsField: "tags",
  orderField,
  direction: "DESCENDING",
  note: `List filtered by tag (array-contains), sorted by ${orderField} (asc/desc by reverse scan).`,
}));

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

/** The table entry that serves a query shape (direction ignored: reverse scan), if any. */
export function indexServing(shape: QueryShape): CustomerIndexSpec | undefined {
  return CUSTOMER_LIST_INDEXES.find((spec) => {
    const filter = spec.equalityField ?? spec.arrayContainsField;
    return filter === shape.filterField && spec.orderField === shape.orderField;
  });
}
