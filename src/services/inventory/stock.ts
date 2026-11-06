/**
 * Inventory stock mutations: reserve / release / commit and manual adjustments. Server-only.
 *
 * Documents (see repositories/products.ts for ids and the initial shape):
 *   inventory/{productId}__{variantId}                 { organizationId, productId, variantId,
 *                                                        onHand, reserved, available, createdAt, updatedAt }
 *   inventory/{id}/reservations/{idempotencyKey}       { organizationId, quantity,
 *                                                        status: reserved | released | committed, createdAt, updatedAt }
 *
 * INVARIANTS. All counters are non-negative safe integers and `available === onHand - reserved`
 * (so `reserved <= onHand`). Every mutator is ONE Firestore transaction that reads the inventory
 * document (and the reservation) first and writes after, so a retry always re-reads fresh state;
 * nothing outside the callback is mutated. A document that already violates the invariants (or an
 * operation that would make a counter negative) is data corruption: a plain internal Error with a
 * generic message is thrown (a logged 500) and nothing is written. Counters are never clamped.
 *
 * RESERVATIONS ARE SERVER-ONLY. There is NO HTTP route for reserve / release / commit in this
 * phase: Phase 5 orders call these functions directly (and unchanged). The idempotency key is the
 * reservation id (one per order line, for example); retrying a call with the same key is safe:
 *   - reserve   same key + same quantity -> the existing reservation is returned (any status), no
 *               count change; same key + DIFFERENT quantity -> ConflictError.
 *   - release   only from `reserved`; a repeat is a no-op; after a commit -> ConflictError.
 *   - commit    only from `reserved`; a repeat is a no-op (stock leaves once); after a release ->
 *               ConflictError.
 * An unknown key, a missing inventory document and another organization's inventory document are
 * the same NotFoundError (no existence oracle).
 *
 * CONCURRENCY. Transactions run with `maxAttempts: 30`. If contention outlasts the attempts the
 * caller gets ConflictError("Inventory is busy, please try again"), which callers should treat as
 * RETRYABLE. Firestore sustains about 1 write per second on a single document in production, and
 * every stock unit is one document, so a very hot product (flash sale) can see this error under
 * heavy parallel load; sharding counters is deliberately out of scope.
 *
 * ADJUSTMENTS (`adjustStock`, owner/admin through the API) change `onHand` by a nonzero delta and
 * are audited in the same transaction (a failing audit write persists nothing).
 */
import "server-only";

import {
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";

import { MAX_ON_HAND } from "@/config/inventory";
import {
  ConflictError,
  InsufficientStockError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { isValidIdSegment } from "@/lib/ids";
import { assertOrgCtx, type OrgCtx } from "@/lib/org-context";
import { writeAuditInTransaction } from "@/lib/security/audit";
import { invalid } from "@/lib/validation-error";
import { inventoryRepo } from "@/repositories/inventory";
import { inventoryRef } from "@/repositories/products";
import {
  adjustFieldsSchema,
  type InventoryRecord,
  type ReservationStatus,
} from "@/schemas/inventory";

export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_ATTEMPTS = 30;
const BUSY_MESSAGE = "Inventory is busy, please try again";
const KEY_CONFLICT_MESSAGE = "This idempotency key was already used with a different quantity";
const RELEASED_MESSAGE = "This reservation was already released";
const COMMITTED_MESSAGE = "This reservation was already committed";
const BELOW_RESERVED_MESSAGE = "Stock cannot be reduced below the reserved quantity";
const CORRUPT_MESSAGE = "Inventory record is inconsistent";

const STATUSES: readonly ReservationStatus[] = ["reserved", "released", "committed"];

interface Counts {
  onHand: number;
  reserved: number;
  available: number;
}

export interface ReservationResult {
  reservationId: string;
  available: number;
  status: ReservationStatus;
}

// ---- validation ----------------------------------------------------------------------------

function assertOrgId(orgId: unknown): asserts orgId is string {
  // Server-supplied: fail closed with a plain Error, never reach Firestore with a bad org.
  if (!isValidIdSegment(orgId)) throw new Error("Inventory service requires an organization");
}

function assertQuantity(quantity: unknown): asserts quantity is number {
  if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity <= 0) {
    throw invalid("quantity", "Quantity must be a positive whole number");
  }
}

function assertKey(key: unknown): asserts key is string {
  if (!isValidIdSegment(key) || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw invalid("idempotencyKey", "Invalid idempotency key");
  }
}

/** Invalid ids are the same NotFound as missing documents. */
function inventoryRefOrNotFound(productId: string, variantId: string) {
  let inv: DocumentReference;
  try {
    inv = inventoryRef(productId, variantId);
  } catch (err) {
    if (err instanceof ValidationError) throw new NotFoundError();
    throw err;
  }
  return inv;
}

// ---- reading -------------------------------------------------------------------------------

const isCount = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

function corrupt(): never {
  throw new Error(CORRUPT_MESSAGE);
}

/** Counters of an inventory snapshot of this organization; NotFound otherwise; corrupt -> Error. */
function readCounts(snap: DocumentSnapshot, orgId: string): Counts {
  const data = snap.exists ? snap.data() : undefined;
  if (!data || data.organizationId !== orgId) throw new NotFoundError();
  const { onHand, reserved, available } = data as Record<string, unknown>;
  if (
    !isCount(onHand) ||
    !isCount(reserved) ||
    !isCount(available) ||
    available !== onHand - reserved
  ) {
    corrupt();
  }
  return { onHand, reserved, available };
}

interface Reservation {
  quantity: number;
  status: ReservationStatus;
}

function readReservation(snap: DocumentSnapshot, orgId: string): Reservation | null {
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown> | undefined;
  const quantity = data?.quantity;
  const status = data?.status;
  if (
    !data ||
    data.organizationId !== orgId ||
    typeof quantity !== "number" ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    !STATUSES.includes(status as ReservationStatus)
  ) {
    corrupt();
  }
  return { quantity, status: status as ReservationStatus };
}

/** Counters to write: never negative, `available` always derived. */
function nextCounts(onHand: number, reserved: number): Counts {
  if (!isCount(onHand) || !isCount(reserved) || reserved > onHand) corrupt();
  return { onHand, reserved, available: onHand - reserved };
}

// ---- transaction runner --------------------------------------------------------------------

/** Firestore ABORTED (gRPC 10) or HTTP 409: contention that outlasted the attempts. */
function isContention(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 10 || code === 409 || code === "aborted";
}

async function runStockTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  try {
    return await adminDb().runTransaction(fn, { maxAttempts: MAX_ATTEMPTS });
  } catch (err) {
    if (isContention(err)) throw new ConflictError(BUSY_MESSAGE);
    throw err;
  }
}

// ---- reserve / release / commit ------------------------------------------------------------

/**
 * Reserves `quantity` units for `idempotencyKey`. Returns the reservation id (the key), the
 * current `available` and the reservation status. See the file header for the retry rules.
 * Throws InsufficientStockError when `onHand - reserved < quantity` (nothing is written).
 */
export async function reserveStock(
  orgId: string,
  productId: string,
  variantId: string,
  quantity: number,
  idempotencyKey: string,
): Promise<ReservationResult> {
  assertOrgId(orgId);
  assertQuantity(quantity);
  assertKey(idempotencyKey);
  const invRef = inventoryRefOrNotFound(productId, variantId);
  const resRef = invRef.collection("reservations").doc(idempotencyKey);

  return runStockTransaction(async (tx) => {
    // Reads first (both documents), writes after.
    const [invSnap, resSnap] = await tx.getAll(invRef, resRef);
    const counts = readCounts(invSnap!, orgId);
    const existing = readReservation(resSnap!, orgId);

    if (existing) {
      if (existing.quantity !== quantity) throw new ConflictError(KEY_CONFLICT_MESSAGE);
      return {
        reservationId: idempotencyKey,
        available: counts.available,
        status: existing.status,
      };
    }

    if (counts.available < quantity) throw new InsufficientStockError();
    const next = nextCounts(counts.onHand, counts.reserved + quantity);
    tx.create(resRef, {
      organizationId: orgId,
      quantity,
      status: "reserved",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(invRef, {
      reserved: next.reserved,
      available: next.available,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {
      reservationId: idempotencyKey,
      available: next.available,
      status: "reserved" as const,
    };
  });
}

/**
 * Releases a reservation (reserved -> released, `reserved -= quantity`). A repeat is a no-op;
 * releasing a committed reservation is a ConflictError; an unknown key is NotFound.
 */
export async function releaseStock(
  orgId: string,
  productId: string,
  variantId: string,
  idempotencyKey: string,
): Promise<void> {
  assertOrgId(orgId);
  assertKey(idempotencyKey);
  const invRef = inventoryRefOrNotFound(productId, variantId);
  const resRef = invRef.collection("reservations").doc(idempotencyKey);

  await runStockTransaction(async (tx) => {
    const [invSnap, resSnap] = await tx.getAll(invRef, resRef);
    const counts = readCounts(invSnap!, orgId);
    const res = readReservation(resSnap!, orgId);
    if (!res) throw new NotFoundError();
    if (res.status === "released") return;
    if (res.status === "committed") throw new ConflictError(COMMITTED_MESSAGE);

    const next = nextCounts(counts.onHand, counts.reserved - res.quantity);
    tx.update(resRef, { status: "released", updatedAt: FieldValue.serverTimestamp() });
    tx.update(invRef, {
      reserved: next.reserved,
      available: next.available,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

/**
 * Commits a reservation (reserved -> committed): the stock leaves the shelf
 * (`onHand -= quantity`, `reserved -= quantity`). A repeat is a no-op; committing a released
 * reservation is a ConflictError; an unknown key is NotFound.
 */
export async function commitStock(
  orgId: string,
  productId: string,
  variantId: string,
  idempotencyKey: string,
): Promise<void> {
  assertOrgId(orgId);
  assertKey(idempotencyKey);
  const invRef = inventoryRefOrNotFound(productId, variantId);
  const resRef = invRef.collection("reservations").doc(idempotencyKey);

  await runStockTransaction(async (tx) => {
    const [invSnap, resSnap] = await tx.getAll(invRef, resRef);
    const counts = readCounts(invSnap!, orgId);
    const res = readReservation(resSnap!, orgId);
    if (!res) throw new NotFoundError();
    if (res.status === "committed") return;
    if (res.status === "released") throw new ConflictError(RELEASED_MESSAGE);

    const next = nextCounts(counts.onHand - res.quantity, counts.reserved - res.quantity);
    tx.update(resRef, { status: "committed", updatedAt: FieldValue.serverTimestamp() });
    tx.update(invRef, {
      onHand: next.onHand,
      reserved: next.reserved,
      available: next.available,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

// ---- adjustments ---------------------------------------------------------------------------

/**
 * Changes `onHand` of one stock unit by `delta` (nonzero, |delta| <= 1_000_000) and writes an
 * `inventory.adjust` audit row (before / after counters, delta, reason) in the same transaction.
 * The result must keep `onHand >= reserved` (ConflictError otherwise) and `onHand <= 1_000_000_000`
 * (ValidationError). Returns the updated record.
 */
export async function adjustStock(
  ctx: OrgCtx,
  productId: string,
  variantId: string,
  input: { delta: number; reason: string },
): Promise<InventoryRecord> {
  assertOrgCtx(ctx, "Inventory");
  const parsed = adjustFieldsSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => ({ path: String(i.path[0] ?? "body"), message: i.message })),
    );
  }
  const { delta, reason } = parsed.data;
  const orgId = ctx.organizationId;
  const invRef = inventoryRefOrNotFound(productId, variantId);

  await runStockTransaction(async (tx) => {
    const counts = readCounts(await tx.get(invRef), orgId);
    const onHand = counts.onHand + delta;
    if (onHand < counts.reserved) throw new ConflictError(BELOW_RESERVED_MESSAGE);
    if (onHand > MAX_ON_HAND) throw invalid("delta", "Resulting stock is too large");
    const next = nextCounts(onHand, counts.reserved);

    tx.update(invRef, {
      onHand: next.onHand,
      available: next.available,
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAuditInTransaction(tx, {
      organizationId: orgId,
      actorUid: ctx.uid,
      action: "inventory.adjust",
      resource: "inventory",
      resourceId: invRef.id,
      before: { onHand: counts.onHand, reserved: counts.reserved, available: counts.available },
      after: {
        onHand: next.onHand,
        reserved: next.reserved,
        available: next.available,
        delta,
        reason,
      },
    });
  });

  const stored = inventoryRepo.fromSnapshot(await invRef.get(), orgId);
  if (!stored) throw new NotFoundError();
  return stored;
}
