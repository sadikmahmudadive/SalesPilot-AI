/**
 * Composite indexes required by `listProducts`, as a typed table. Pure data, no I/O.
 *
 * Every list query is `where organizationId == org AND archived == bool [AND one equality
 * filter] [AND prefix range] ORDER BY <field> <dir>, __name__ <dir>`. The Firestore emulator
 * does NOT enforce indexes, so a missing entry only fails in production (FAILED_PRECONDITION).
 * `product-indexes.test.ts` asserts that
 *   - the table and the `products` entries of firestore.indexes.json are EXACTLY the same set
 *     (nothing missing, nothing extra), in the exact Firebase format,
 *   - every query the service can build (see `buildListPlan`) is served by an entry with the
 *     SAME order direction.
 * Adding a filter or sort to the service means adding it here AND to the JSON.
 *
 * DIRECTION: as for customers, we do not rely on Firestore serving a descending query from an
 * ascending index. Every (filter, order field) pair the service can issue gets BOTH an ASCENDING
 * and a DESCENDING index, each with `__name__` in the same direction as the order field (the
 * tie-break `list()` uses). Only the SKU prefix search, which always orders ascending, has a
 * single ASCENDING entry. The unfiltered name index (nameLower ASC) also serves the name prefix
 * search (range on the ordered field).
 */
import {
  INDEX_DIRECTIONS,
  directionWord as dirWord,
  type FirestoreIndex,
  type FirestoreIndexField,
  type IndexDirection,
} from "@/lib/firestore-index-table";

import type { FilterField, OrderField, QueryShape } from "./product-query";

export interface ProductIndexSpec {
  /** Equality filter field (ASCENDING in the index). `archived` is always present and not listed. */
  equalityField?: FilterField;
  /** Field the query orders by (and, for search, applies the prefix range to). */
  orderField: OrderField;
  /** Direction of the order field and of `__name__` in the index. */
  direction: IndexDirection;
  note: string;
}

const SORT_FIELDS = ["createdAt", "nameLower", "updatedAt"] as const;
const DIRECTIONS = INDEX_DIRECTIONS;
const EQUALITY_FIELDS: readonly FilterField[] = ["availability", "categoryId"];

const base = SORT_FIELDS.flatMap((orderField) =>
  DIRECTIONS.map<ProductIndexSpec>((direction) => ({
    orderField,
    direction,
    note:
      orderField === "nameLower" && direction === "ASCENDING"
        ? "List sorted by name ascending, and the name prefix search."
        : `List sorted by ${orderField} ${dirWord(direction)}.`,
  })),
);

const equality = EQUALITY_FIELDS.flatMap((equalityField) =>
  SORT_FIELDS.flatMap((orderField) =>
    DIRECTIONS.map<ProductIndexSpec>((direction) => ({
      equalityField,
      orderField,
      direction,
      note: `List filtered by ${equalityField}, sorted by ${orderField} ${dirWord(direction)}.`,
    })),
  ),
);

const skuSearch: ProductIndexSpec = {
  orderField: "skuLower",
  direction: "ASCENDING",
  note: "SKU prefix search: range on skuLower, ordered by skuLower ascending.",
};

export const PRODUCT_LIST_INDEXES: readonly ProductIndexSpec[] = [...base, ...equality, skuSearch];

/** The entry exactly as it must appear in firestore.indexes.json (key order included). */
export function toFirestoreIndex(spec: ProductIndexSpec): FirestoreIndex {
  const fields: FirestoreIndexField[] = [
    { fieldPath: "organizationId", order: "ASCENDING" },
    { fieldPath: "archived", order: "ASCENDING" },
  ];
  if (spec.equalityField) fields.push({ fieldPath: spec.equalityField, order: "ASCENDING" });
  fields.push({ fieldPath: spec.orderField, order: spec.direction });
  fields.push({ fieldPath: "__name__", order: spec.direction });
  return { collectionGroup: "products", queryScope: "COLLECTION", fields };
}

/** The table entry that serves a query shape: same filter, order field AND direction. */
export function indexServing(shape: QueryShape): ProductIndexSpec | undefined {
  const direction: IndexDirection = shape.direction === "asc" ? "ASCENDING" : "DESCENDING";
  return PRODUCT_LIST_INDEXES.find(
    (spec) =>
      spec.equalityField === shape.filterField &&
      spec.orderField === shape.orderField &&
      spec.direction === direction,
  );
}

/** The one index of the category list (`organizationId == org ORDER BY nameLower`). */
export const CATEGORY_LIST_INDEX: FirestoreIndex = {
  collectionGroup: "categories",
  queryScope: "COLLECTION",
  fields: [
    { fieldPath: "organizationId", order: "ASCENDING" },
    { fieldPath: "nameLower", order: "ASCENDING" },
    { fieldPath: "__name__", order: "ASCENDING" },
  ],
};
