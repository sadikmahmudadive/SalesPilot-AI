import type { FirestoreIndex, IndexDirection } from "@/lib/firestore-index-table";

export interface PaymentIndexSpec {
  collectionGroup: "paymentAttempts" | "gatewayAccounts";
  equalityFields: readonly string[];
  orderField: string;
  direction: IndexDirection;
  note: string;
}

export const PAYMENT_INDEXES: readonly PaymentIndexSpec[] = [
  {
    collectionGroup: "paymentAttempts",
    equalityFields: ["state"],
    orderField: "createdAt",
    direction: "ASCENDING",
    note: "Payment attempt reconciler: state in [created, redirected] order by createdAt.",
  },
  {
    collectionGroup: "gatewayAccounts",
    equalityFields: ["organizationId"],
    orderField: "createdAt",
    direction: "ASCENDING",
    note: "List gateway accounts for an organization ordered by createdAt.",
  },
];

export function toFirestoreIndex(spec: PaymentIndexSpec): FirestoreIndex {
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
