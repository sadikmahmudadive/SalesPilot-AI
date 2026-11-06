/**
 * Composite indexes required by `listInventory` (and the low-stock count of the overview), as a
 * typed table. Pure data, no I/O.
 *
 * The Firestore emulator does NOT enforce indexes, so a missing entry only fails in production
 * (FAILED_PRECONDITION). `inventory-indexes.test.ts` asserts that the table and the `inventory`
 * entries of firestore.indexes.json are EXACTLY the same set (in the exact Firebase format) and
 * that every query shape `buildListPlan` can produce is served by an entry.
 *
 * Unlike customers and products, the inventory list has no user-selectable sort direction, so
 * each shape needs exactly one index in the direction the query uses, with `__name__` in the same
 * direction as the last order field (the tie-break `OrgRepository.list` adds).
 */
import type { InventoryQueryShape } from "./inventory-query";

export type IndexDirection = "ASCENDING" | "DESCENDING";

export interface InventoryIndexSpec {
  /** The list query shape this entry serves; absent for non-list queries (the count). */
  shape?: InventoryQueryShape;
  /** Fields after `organizationId` (and before the implicit `__name__` when `withName`). */
  fields: ReadonlyArray<{ fieldPath: string; order: IndexDirection }>;
  /** Whether `__name__` (same direction as the last field) is part of the index. */
  withName: boolean;
  note: string;
}

export const INVENTORY_LIST_INDEXES: readonly InventoryIndexSpec[] = [
  {
    shape: "default",
    fields: [{ fieldPath: "updatedAt", order: "DESCENDING" }],
    withName: true,
    note: "Default list: newest changes first.",
  },
  {
    shape: "byProduct",
    fields: [
      { fieldPath: "productId", order: "ASCENDING" },
      { fieldPath: "variantId", order: "ASCENDING" },
    ],
    withName: true,
    note: "Variants of one product, sorted by variant id.",
  },
  {
    shape: "lowStock",
    fields: [{ fieldPath: "available", order: "ASCENDING" }],
    withName: true,
    note: "Low stock list: range on available (<= threshold), lowest first.",
  },
  {
    fields: [{ fieldPath: "available", order: "ASCENDING" }],
    withName: false,
    note: "Organization + available: low-stock COUNT query of the overview (no ordering).",
  },
];

export interface FirestoreIndexField {
  fieldPath: string;
  order: "ASCENDING" | "DESCENDING";
}
export interface FirestoreIndex {
  collectionGroup: string;
  queryScope: "COLLECTION";
  fields: FirestoreIndexField[];
}

/** The entry exactly as it must appear in firestore.indexes.json (key order included). */
export function toFirestoreIndex(spec: InventoryIndexSpec): FirestoreIndex {
  const fields: FirestoreIndexField[] = [
    { fieldPath: "organizationId", order: "ASCENDING" },
    ...spec.fields.map((f) => ({ fieldPath: f.fieldPath, order: f.order })),
  ];
  if (spec.withName) {
    fields.push({ fieldPath: "__name__", order: spec.fields[spec.fields.length - 1]!.order });
  }
  return { collectionGroup: "inventory", queryScope: "COLLECTION", fields };
}

/** The table entry that serves a list query shape. */
export function indexServing(shape: InventoryQueryShape): InventoryIndexSpec | undefined {
  return INVENTORY_LIST_INDEXES.find((spec) => spec.shape === shape);
}
