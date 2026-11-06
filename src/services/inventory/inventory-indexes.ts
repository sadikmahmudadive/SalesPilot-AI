/**
 * Composite indexes required by `listInventory`, as a typed table. Pure data, no I/O.
 *
 * The Firestore emulator does NOT enforce indexes, so a missing entry only fails in production
 * (FAILED_PRECONDITION). `inventory-indexes.test.ts` asserts that the table and the `inventory`
 * entries of firestore.indexes.json are EXACTLY the same set (in the exact Firebase format) and
 * that every query shape `buildListPlan` can produce is served by an entry.
 *
 * The lowStock entry (organizationId, available ASC, __name__ ASC) ALSO serves Task 22's low-stock
 * COUNT query (`organizationId == org AND available <= N`, implicit order `available ASC,
 * __name__ ASC`). A separate [organizationId, available] entry would be the SAME index (the
 * trailing `__name__ ASC` is implicit in Firestore) and deploying both fails, so there is none.
 *
 * Unlike customers and products, the inventory list has no user-selectable sort direction, so
 * each shape needs exactly one index in the direction the query uses, with `__name__` in the same
 * direction as the last order field (the tie-break `OrgRepository.list` adds).
 */
import {
  type FirestoreIndex,
  type FirestoreIndexField,
  type IndexDirection,
} from "@/lib/firestore-index-table";

import type { InventoryQueryShape } from "./inventory-query";

export interface InventoryIndexSpec {
  /** The list query shape this entry serves. */
  shape: InventoryQueryShape;
  /** Fields after `organizationId`; `__name__` follows in the direction of the last one. */
  fields: ReadonlyArray<{ fieldPath: string; order: IndexDirection }>;
  note: string;
}

export const INVENTORY_LIST_INDEXES: readonly InventoryIndexSpec[] = [
  {
    shape: "default",
    fields: [{ fieldPath: "updatedAt", order: "DESCENDING" }],
    note: "Default list: newest changes first.",
  },
  {
    shape: "byProduct",
    fields: [
      { fieldPath: "productId", order: "ASCENDING" },
      { fieldPath: "variantId", order: "ASCENDING" },
    ],
    note: "Variants of one product, sorted by variant id.",
  },
  {
    shape: "lowStock",
    fields: [{ fieldPath: "available", order: "ASCENDING" }],
    note: "Low stock list (range on available <= threshold, lowest first) and the overview count.",
  },
];

/** The entry exactly as it must appear in firestore.indexes.json (key order included). */
export function toFirestoreIndex(spec: InventoryIndexSpec): FirestoreIndex {
  const fields: FirestoreIndexField[] = [
    { fieldPath: "organizationId", order: "ASCENDING" },
    ...spec.fields.map((f) => ({ fieldPath: f.fieldPath, order: f.order })),
    { fieldPath: "__name__", order: spec.fields[spec.fields.length - 1]!.order },
  ];
  return { collectionGroup: "inventory", queryScope: "COLLECTION", fields };
}

/** The table entry that serves a list query shape. */
export function indexServing(shape: InventoryQueryShape): InventoryIndexSpec | undefined {
  return INVENTORY_LIST_INDEXES.find((spec) => spec.shape === shape);
}
