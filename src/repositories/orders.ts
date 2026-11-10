/**
 * Order data access. Server-only.
 *
 *   orders/{orderId}                           the order (see `Order`)
 *   orderEvents/{eventId}                      append-only timeline of an order
 *   orderCounters/{orgId}                      { organizationId, next }  per-org order-number counter
 *   orderNumbers/{orgId}_{orderNumber}         { organizationId, orderId }  uniqueness lock
 *   orderIdempotency/{orgId}_{sha256(key)[0..40]}  { organizationId, orderId }  create idempotency
 *   orderSettings/{orgId}                      { organizationId, ...OrderSettings }
 *
 * All six collections are server-only: clients are denied by the catch-all in firestore.rules.
 *
 * `holdExpiresAt` is stored as a Firestore Timestamp (the expiry sweep queries
 * `holdExpiresAt <= now`); `OrgRepository.fromSnapshot` converts it to an ISO string for `Order`.
 *
 * Filterable fields may be dotted paths (`customerSnapshot.phoneE164`): the base repository
 * passes the string to Firestore as a field path, so nested fields filter normally.
 */
import "server-only";

import { createHash } from "node:crypto";

import type { DocumentReference, Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { isValidIdSegment } from "@/lib/ids";
import { invalid } from "@/lib/validation-error";
import type { Order, OrderEvent } from "@/schemas/order";

import { OrgRepository, type OrgCreateInput } from "./base";

export const ORDERS = "orders";
export const ORDER_EVENTS = "orderEvents";
export const ORDER_COUNTERS = "orderCounters";
export const ORDER_NUMBERS = "orderNumbers";
export const ORDER_IDEMPOTENCY = "orderIdempotency";
export const ORDER_SETTINGS = "orderSettings";

export const orderRepo = new OrgRepository<Order>(ORDERS, {
  filterable: [
    "status",
    "paymentStatus",
    "customerId",
    "orderNumber",
    "customerSnapshot.phoneE164",
  ],
  sortable: ["createdAt"],
});

export const orderEventRepo = new OrgRepository<OrderEvent>(ORDER_EVENTS, {
  filterable: ["orderId"],
  sortable: ["createdAt"],
});

function assertOrgId(orgId: unknown): asserts orgId is string {
  if (!isValidIdSegment(orgId)) throw invalid("organizationId", "Invalid id");
}

function col(name: string) {
  return adminDb().collection(name);
}

/** `orderCounters/{orgId}`: `{ organizationId, next }` where `next` is the number handed out next. */
export function counterRef(orgId: string): DocumentReference {
  assertOrgId(orgId);
  return col(ORDER_COUNTERS).doc(orgId);
}

/** `orderNumbers/{orgId}_{orderNumber}`: `{ organizationId, orderId }`. */
export function orderNumberRef(orgId: string, orderNumber: string): DocumentReference {
  assertOrgId(orgId);
  const id = `${orgId}_${orderNumber}`;
  if (typeof orderNumber !== "string" || !isValidIdSegment(id)) {
    throw invalid("orderNumber", "Invalid order number");
  }
  return col(ORDER_NUMBERS).doc(id);
}

/** `orderIdempotency/{orgId}_{sha256(key) hex[0..40]}`: `{ organizationId, orderId }`. */
export function idempotencyRef(orgId: string, key: string): DocumentReference {
  assertOrgId(orgId);
  if (typeof key !== "string" || key.length === 0) {
    throw invalid("idempotencyKey", "Invalid idempotency key");
  }
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 40);
  return col(ORDER_IDEMPOTENCY).doc(`${orgId}_${hash}`);
}

/** `orderSettings/{orgId}`. */
export function settingsRef(orgId: string): DocumentReference {
  assertOrgId(orgId);
  return col(ORDER_SETTINGS).doc(orgId);
}

/** 1 -> "SP-000001". Six digits minimum; grows past 999999 without truncation. */
export function formatOrderNumber(n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error("Order number must be a positive integer");
  return `SP-${String(n).padStart(6, "0")}`;
}

/**
 * Reserves the next order number of an organization inside the caller's transaction.
 *
 * It READS the counter and then WRITES the incremented value. Firestore transactions require
 * every read before any write, so callers MUST call this before their own `tx.set/create/update`
 * (do all other reads first as well, then call this, then write). Concurrent transactions on one
 * organization contend on the counter document; Firestore serializes them (the loser retries), so
 * numbers are distinct and consecutive. A transaction that aborts after calling this does not
 * consume a number.
 */
export async function nextOrderNumber(tx: Transaction, orgId: string): Promise<string> {
  const ref = counterRef(orgId);
  const snap = await tx.get(ref);
  const stored: unknown = snap.exists ? snap.get("next") : 1;
  if (typeof stored !== "number" || !Number.isSafeInteger(stored) || stored < 1) {
    throw new Error("Order counter is corrupt");
  }
  tx.set(ref, { organizationId: orgId, next: stored + 1 });
  return formatOrderNumber(stored);
}

/**
 * The reference and payload of a new `orderEvents` document, for `tx.create(ref, data)` in the
 * same transaction as the state change it records. `organizationId`/`createdAt` are managed.
 */
export function buildOrderEvent(
  orgId: string,
  e: Omit<OrderEvent, "id" | "organizationId" | "createdAt">,
): { ref: DocumentReference; data: Record<string, unknown> } {
  return orderEventRepo.build(orgId, e as OrgCreateInput<OrderEvent>);
}
