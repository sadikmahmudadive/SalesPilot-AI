/**
 * Composite indexes required by the order queries, as a typed table. Pure data, no I/O.
 *
 * The Firestore emulator does NOT enforce indexes, so a missing entry only fails in production
 * (FAILED_PRECONDITION). `order-indexes.test.ts` asserts that every entry is in
 * firestore.indexes.json (exact format) and that the JSON holds no other `orders` /
 * `orderEvents` index. Adding a filter, sort or sweep query means adding it here AND to the JSON.
 *
 * Tenant list queries (`orderRepo.list`) are
 * `where organizationId == org [AND one equality filter] ORDER BY createdAt <dir>, __name__ <dir>`.
 * As in customer-indexes.ts, every (filter, createdAt) pair gets BOTH directions, each with
 * `__name__` in the same direction as the order field.
 *
 * Cross-organization sweep queries (sweep.ts) have no `organizationId` clause:
 *   - orders where status == "draft"/"confirmed" AND holdExpiresAt <= now ORDER BY holdExpiresAt
 *     (hold expiry, one query per status),
 *   - orders where stockState == releasing/committing/pending AND updatedAt <= cutoff ORDER BY
 *     updatedAt (stuck stock, one query per state),
 *   - orders where hasReleasingLines == true ORDER BY __name__ (parked lines): a single-field
 *     equality, served by the automatic single-field index, so no entry here.
 *
 * `orderEvents` timeline: `organizationId == org AND orderId == id ORDER BY createdAt ASC`.
 * Production verification requires `firebase deploy --only firestore:indexes`.
 */
import {
  INDEX_DIRECTIONS,
  directionWord as dirWord,
  type FirestoreIndex,
  type IndexDirection,
} from "@/lib/firestore-index-table";

export interface OrderIndexSpec {
  collectionGroup: "orders" | "orderEvents";
  /** Equality fields, all ASCENDING, in index order (including `organizationId` when tenant-scoped). */
  equalityFields: readonly string[];
  /** Field the query orders by. */
  orderField: string;
  /** Direction of the order field and of `__name__` in the index. */
  direction: IndexDirection;
  /** True for the sweep indexes that have no `organizationId` clause. */
  crossOrg?: boolean;
  note: string;
}

/** Fields `orderRepo.list` may filter on (besides `organizationId`), each served with `createdAt`. */
export const ORDER_FILTER_FIELDS = [
  "status",
  "paymentStatus",
  "customerId",
  "customerSnapshot.phoneE164",
] as const;

const tenantList = [undefined, ...ORDER_FILTER_FIELDS].flatMap((filter) =>
  INDEX_DIRECTIONS.map<OrderIndexSpec>((direction) => ({
    collectionGroup: "orders",
    equalityFields: filter ? ["organizationId", filter] : ["organizationId"],
    orderField: "createdAt",
    direction,
    note: filter
      ? `Order list filtered by ${filter}, sorted by createdAt ${dirWord(direction)}.`
      : `Unfiltered order list sorted by createdAt ${dirWord(direction)}.`,
  })),
);

const sweep: OrderIndexSpec[] = [
  {
    collectionGroup: "orders",
    equalityFields: ["status"],
    orderField: "holdExpiresAt",
    direction: "ASCENDING",
    crossOrg: true,
    note: "Hold expiry sweep: status equality, holdExpiresAt range, oldest first, across organizations.",
  },
  {
    collectionGroup: "orders",
    equalityFields: ["stockState"],
    orderField: "updatedAt",
    direction: "ASCENDING",
    crossOrg: true,
    note: "Stuck stock sweep: stockState equality, least recently updated first, across organizations.",
  },
];

const events: OrderIndexSpec[] = [
  {
    collectionGroup: "orderEvents",
    equalityFields: ["organizationId", "orderId"],
    orderField: "createdAt",
    direction: "ASCENDING",
    note: "Order event timeline: events of one order, oldest first.",
  },
];

export const ORDER_INDEXES: readonly OrderIndexSpec[] = [...tenantList, ...sweep, ...events];

/** The entry exactly as it must appear in firestore.indexes.json (key order included). */
export function toFirestoreIndex(spec: OrderIndexSpec): FirestoreIndex {
  return {
    collectionGroup: spec.collectionGroup,
    queryScope: "COLLECTION",
    fields: [
      ...spec.equalityFields.map((fieldPath) => ({
        fieldPath,
        order: "ASCENDING" as IndexDirection,
      })),
      { fieldPath: spec.orderField, order: spec.direction },
      { fieldPath: "__name__", order: spec.direction },
    ],
  };
}
