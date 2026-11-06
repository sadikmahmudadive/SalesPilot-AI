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
 * document (and the reservation) first and writes after. The SDK re-runs the callback on
 * contention and the callback re-reads fresh state each time; nothing outside the callback is
 * mutated. A document that already violates the invariants (or an operation that would make a
 * counter negative) is data corruption: a plain internal Error with a generic message is thrown
 * (a logged 500) and nothing is written. Counters are never clamped.
 *
 * RESERVATIONS ARE SERVER-ONLY. There is NO HTTP route for reserve / release / commit in this
 * phase: Phase 5 orders call these functions directly (and unchanged). The idempotency key is the
 * reservation id; retrying a call with the same key is safe:
 *   - reserve   same key + same quantity -> the existing reservation is returned (any status), no
 *               count change; same key + DIFFERENT quantity -> ConflictError.
 *   - release   only from `reserved`; a repeat is a no-op; after a commit -> ConflictError.
 *   - commit    only from `reserved`; a repeat is a no-op (stock leaves once); after a release ->
 *               ConflictError.
 * An unknown key, a missing inventory document and another organization's inventory document are
 * the same NotFoundError (no existence oracle).
 *
 * NOTES FOR PHASE 5 (orders), which calls these functions:
 *   - CHECK `status` OF THE RESERVE RESULT. A resolved `reserveStock` can carry
 *     `status: "released"` or `"committed"` (a replay of a key whose reservation already ended);
 *     only `"reserved"` means the units are held now.
 *   - The idempotency key must be per ORDER LINE (stable across retries of one line, different for
 *     every line; keys are scoped to one stock unit, so one key per unit per line is enough).
 *   - Reserve does NOT check the product's availability or archived state; the caller must.
 *   - Reservations have NO expiry. An abandoned `reserved` reservation holds stock forever, so
 *     Phase 5 needs an expiry policy plus a sweep that releases them, and a retention rule for
 *     finished reservation documents (they are never deleted here; they are the idempotency record).
 *   - A variant that was EVER reserved can never be removed from its product: variant removal is
 *     refused while the `reservations` subcollection is non-empty (see products.ts).
 *
 * CONCURRENCY AND RETRY BUDGET. The Firestore SDK retries a transaction on ABORTED with an
 * exponential backoff (1 s start, x1.5, +/-50% jitter, 60 s cap). That backoff gives up after 10
 * retries, so `maxAttempts` above 11 is silently capped at 11 attempts (and the SDK would then
 * reject with a codeless "Exceeded maximum number of retries" error instead of the real one).
 * Hence the budgets:
 *   - reserve / release / commit  `RESERVATION_MAX_ATTEMPTS = 11`: about 2 minutes of backoff in
 *     total (1 + 1.5 + 2.3 + 3.4 + 5.1 + 7.6 + 11.4 + 17.1 + 25.6 + 38.4 s on average). It is longer
 *     when the SDK resets the backoff to the maximum (RESOURCE_EXHAUSTED and similar codes).
 *   - adjust (on the HTTP path)   `ADJUST_MAX_ATTEMPTS = 5`: about 8 s of backoff, so a request
 *     answers within roughly 10 s.
 * Only ABORTED (contention) that outlasts the attempts becomes `InventoryBusyError` (a
 * ConflictError, code CONFLICT, 409, message "Inventory is busy, please try again"), which callers
 * treat as RETRYABLE; every other ConflictError is terminal. Other failures (UNAVAILABLE,
 * RESOURCE_EXHAUSTED, ...) propagate unchanged as logged 500s: an outage must not look like busy.
 * Each exhaustion is logged with `logger.warn` (the error response of an AppError is not logged).
 * Firestore sustains about 1 write per second on one document in production and every stock unit
 * is one document, so a very hot product (flash sale) can see this error under heavy parallel
 * load; sharding counters is deliberately out of scope.
 *
 * ADJUSTMENTS (`adjustStock`, owner/admin through the API) change `onHand` by a nonzero delta and
 * are audited in the same transaction (a failing audit write persists nothing). `adjustStock` is
 * NOT idempotent: a lost acknowledgement (the commit succeeded but the response did not arrive)
 * followed by a client retry applies the delta TWICE. The UI (Task 19) must guard against double
 * submit and must not auto-retry an adjustment.
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
  InventoryBusyError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { isContention } from "@/lib/firestore-errors";
import { isValidIdSegment } from "@/lib/ids";
import { logger } from "@/lib/logger";
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
/** Attempts of reserve / release / commit: the most the SDK's backoff allows (see the header). */
export const RESERVATION_MAX_ATTEMPTS = 11;
/** Attempts of adjustStock, which answers an HTTP request (see the header). */
export const ADJUST_MAX_ATTEMPTS = 5;
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

/**
 * Runs `fn` as a transaction with at most `maxAttempts` attempts. ABORTED that survives all
 * attempts is `InventoryBusyError` (retryable) and is logged; any other error is rethrown as is.
 */
async function runStockTransaction<T>(
  inventoryId: string,
  maxAttempts: number,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  try {
    return await adminDb().runTransaction(fn, { maxAttempts });
  } catch (err) {
    if (isContention(err)) {
      logger.warn("inventory transaction gave up after repeated contention", {
        inventoryId,
        maxAttempts,
      });
      throw new InventoryBusyError();
    }
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

  return runStockTransaction(invRef.id, RESERVATION_MAX_ATTEMPTS, async (tx) => {
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

  await runStockTransaction(invRef.id, RESERVATION_MAX_ATTEMPTS, async (tx) => {
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

  await runStockTransaction(invRef.id, RESERVATION_MAX_ATTEMPTS, async (tx) => {
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

  await runStockTransaction(invRef.id, ADJUST_MAX_ATTEMPTS, async (tx) => {
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
