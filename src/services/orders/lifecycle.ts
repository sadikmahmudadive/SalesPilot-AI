/**
 * Order lifecycle transitions after the draft. Server-only.
 *
 * Every function runs ONE transaction for the status change: it re-reads the order
 * (`fromSnapshot(snap, orgId)`, null -> `NotFoundError`), checks it, applies `transition(...)`
 * from state-machine.ts (the only place a status changes), writes the change, a `status_changed`
 * event (`from`/`to`; a refund records `refund_recorded` with the payment statuses instead) and
 * an `order.<action>` audit row. A failing audit write persists nothing.
 *
 *   confirmOrder        draft -> confirmed. Needs every line held (`stockState: "held"`, no
 *                       `pendingLines`) and `holdExpiresAt` still in the future (else
 *                       `OrderExpiredError`). COD clears the hold (stock stays reserved, no
 *                       expiry); online sets `holdExpiresAt = now + paymentHoldHours`.
 *   startProcessing     confirmed -> processing. An unpaid online order needs `allowUnpaidReason`
 *                       (stored on the order); an expired payment hold is refused. Clears the hold.
 *   markShipped         -> shipped; COMMITS the stock (below).
 *   markDelivered       shipped -> delivered (COD becomes `cod_collected`).
 *   markReturned        -> returned. No stock change: restocking is a manual inventory
 *                       adjustment (the event detail says so).
 *   cancelOrder         -> cancelled; RELEASES the stock (below). `action: "expire"` is the sweep's
 *                       variant: it re-checks inside the transaction that the hold is past.
 *   recordManualRefund  paid -> refunded (status unchanged); records `refund`.
 *
 * STOCK. Release and commit run outside the status transaction (each line is its own inventory
 * transaction), bracketed by `stockState` so an interruption is finished by the sweep:
 *   cancel  T1 status + `stockState: "releasing"`; release the keys of `lines`, `pendingLines`
 *           and `releasingLines`; T2 lines `released`, `stockState: "released"`, the released
 *           lines cleared, event `stock_released`. A failed release leaves `releasing` (logged),
 *           and the cancelled order is still returned.
 *   ship    T1 status + `stockState: "committing"`; commit `lines`; release stale
 *           `releasingLines`; T2 lines `committed`, `stockState: "committed"`, event
 *           `stock_committed`. A transient commit failure (busy, outage) leaves `committing`
 *           (logged) and returns the shipped order; a terminal one (a released or unknown key:
 *           corruption) is logged as an error and surfaces a `ConflictError`.
 * Lines parked in `releasingLines` concurrently (a late reservation of an ended draft) are kept:
 * T2 only drops the keys it released.
 *
 * Stock calls pass `{ maxAttempts: 3 }` for staff and AI callers (HTTP paths); the system actor
 * (the cron sweep) keeps the default budget.
 */
import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { ConflictError, InventoryBusyError, NotFoundError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { assertEntityId, assertOrgCtx } from "@/lib/org-context";
import { writeAuditInTransaction } from "@/lib/security/audit";
import { invalid } from "@/lib/validation-error";
import { buildOrderEvent, orderRepo } from "@/repositories/orders";
import type { Order, OrderEventType, OrderLine } from "@/schemas/order";
import type { StockOptions } from "@/services/inventory/stock";

import { eventActorOf } from "./drafts";
import { isOrderExpired } from "./queries";
import { getOrderSettings, type OrderCtx } from "./settings";
import {
  OrderExpiredError,
  type OrderAction,
  type TransitionResult,
  transition,
} from "./state-machine";
import { commitLines, releaseLines } from "./stock-holds";

const SERVICE = "Orders";
const NOT_READY = "This order is still being prepared, try again";
const CHANGE_IN_PROGRESS = "Another change to this order is in progress";
const NOT_EXPIRED = "This order is no longer expired";
const COMMIT_FAILED = "The stock for this order could not be committed";
const RETURN_NOTE = "Stock was not restocked; record returned items with an inventory adjustment";
const MAX_REASON = 300;

const stockOptions = (ctx: OrderCtx): StockOptions | undefined =>
  ctx.actor?.kind === "system" ? undefined : { maxAttempts: 3 };

function reasonOf(value: unknown, path: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0) throw invalid(path, "Enter a reason");
  if (text.length > MAX_REASON) throw invalid(path, `Use ${MAX_REASON} characters or fewer`);
  return text;
}

const keySet = (lines: readonly OrderLine[]) => new Set(lines.map((l) => l.holdKey));

/** Lines of every set, each hold key once. */
function uniqueLines(...sets: Array<readonly OrderLine[] | null | undefined>): OrderLine[] {
  const seen = new Set<string>();
  const out: OrderLine[] = [];
  for (const line of sets.flatMap((s) => s ?? [])) {
    if (seen.has(line.holdKey)) continue;
    seen.add(line.holdKey);
    out.push(line);
  }
  return out;
}

/** The lines still to release, as the `releasingLines` / `hasReleasingLines` fields to write. */
function remainingReleasing(rest: OrderLine[]) {
  return { releasingLines: rest.length > 0 ? rest : null, hasReleasingLines: rest.length > 0 };
}

async function getStored(orgId: string, orderId: string): Promise<Order> {
  const order = await orderRepo.get(orgId, orderId);
  if (!order) throw new Error("Order is missing after a write");
  return order;
}

// ---- the status transaction ----------------------------------------------------------------

interface Step {
  next: TransitionResult;
  /** Fields written besides status, paymentStatus and updatedAt. */
  fields?: Record<string, unknown>;
  detail?: string | null;
  /** Default: `status_changed` from/to the status. */
  event?: { type: OrderEventType; from: string; to: string };
  /** Extra audit `after` fields. */
  after?: Record<string, unknown>;
}

/**
 * The single status transaction of `action`. `plan` sees the order as read inside the
 * transaction (it may run more than once on contention) and throws to refuse. Returns the order
 * as it was before the change.
 */
async function applyTransition(
  ctx: OrderCtx,
  orderId: string,
  action: OrderAction,
  plan: (order: Order, now: number) => Step,
): Promise<Order> {
  assertOrgCtx(ctx, SERVICE);
  assertEntityId(orderId);
  const orgId = ctx.organizationId;
  const ref = orderRepo.docRef(orderId);
  return adminDb().runTransaction(async (tx) => {
    const order = orderRepo.fromSnapshot(await tx.get(ref), orgId);
    if (!order) throw new NotFoundError();
    const step = plan(order, Date.now());
    const { next } = step;
    tx.update(ref, {
      ...step.fields,
      status: next.status,
      paymentStatus: next.paymentStatus,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const event = buildOrderEvent(orgId, {
      orderId,
      type: step.event?.type ?? "status_changed",
      from: step.event?.from ?? order.status,
      to: step.event?.to ?? next.status,
      actor: eventActorOf(ctx),
      detail: step.detail ?? null,
    });
    tx.create(event.ref, event.data);
    writeAuditInTransaction(tx, {
      organizationId: orgId,
      actorUid: ctx.uid,
      action: `order.${action}`,
      resource: "order",
      resourceId: orderId,
      before: { status: order.status, paymentStatus: order.paymentStatus },
      after: { status: next.status, paymentStatus: next.paymentStatus, ...step.after },
    });
    return order;
  });
}

/** Records a finished stock step (T2): an event, no audit (the status change was audited). */
async function finishStock(
  ctx: OrderCtx,
  orderId: string,
  expected: "releasing" | "committing",
  fields: (order: Order) => Record<string, unknown>,
  type: "stock_released" | "stock_committed",
): Promise<void> {
  const orgId = ctx.organizationId;
  const ref = orderRepo.docRef(orderId);
  await adminDb().runTransaction(async (tx) => {
    const order = orderRepo.fromSnapshot(await tx.get(ref), orgId);
    if (!order || order.stockState !== expected) return; // finished elsewhere (the sweep)
    tx.update(ref, { ...fields(order), updatedAt: FieldValue.serverTimestamp() });
    const event = buildOrderEvent(orgId, {
      orderId,
      type,
      from: null,
      to: null,
      actor: eventActorOf(ctx),
      detail: null,
    });
    tx.create(event.ref, event.data);
  });
}

// ---- transitions ---------------------------------------------------------------------------

export async function confirmOrder(ctx: OrderCtx, orderId: string): Promise<Order> {
  assertOrgCtx(ctx, SERVICE);
  const settings = await getOrderSettings(ctx.organizationId);
  await applyTransition(ctx, orderId, "confirm", (order, now) => {
    const next = transition(order, "confirm");
    if (order.holdExpiresAt === null || Date.parse(order.holdExpiresAt) <= now) {
      throw new OrderExpiredError();
    }
    if (order.stockState !== "held") throw new ConflictError(NOT_READY);
    if (order.pendingLines) throw new ConflictError(CHANGE_IN_PROGRESS);
    const holdExpiresAt =
      order.paymentMethod === "cod"
        ? null
        : Timestamp.fromMillis(now + settings.paymentHoldHours * 3_600_000);
    return { next, fields: { holdExpiresAt, confirmedAt: FieldValue.serverTimestamp() } };
  });
  return getStored(ctx.organizationId, orderId);
}

export async function startProcessing(
  ctx: OrderCtx,
  orderId: string,
  opts?: { allowUnpaidReason?: string },
): Promise<Order> {
  const reason =
    opts?.allowUnpaidReason === undefined
      ? undefined
      : reasonOf(opts.allowUnpaidReason, "allowUnpaidReason");
  await applyTransition(ctx, orderId, "process", (order, now) => {
    const next = transition({ ...order, allowUnpaid: reason !== undefined }, "process");
    if (isOrderExpired(order, now)) throw new OrderExpiredError();
    const unpaid = order.paymentMethod === "online" && order.paymentStatus !== "paid";
    return {
      next,
      fields: { holdExpiresAt: null, ...(unpaid ? { allowUnpaidReason: reason } : {}) },
      detail: unpaid ? `Processing unpaid: ${reason}` : null,
      after: unpaid ? { allowUnpaidReason: reason } : undefined,
    };
  });
  return getStored(ctx.organizationId, orderId);
}

/** Busy inventory and outages are retryable (the sweep finishes); anything else is terminal. */
function isTerminalStockError(error: unknown): boolean {
  if (error instanceof InventoryBusyError) return false;
  return error instanceof ConflictError || error instanceof NotFoundError;
}

export async function markShipped(ctx: OrderCtx, orderId: string): Promise<Order> {
  const before = await applyTransition(ctx, orderId, "ship", (order) => {
    const next = transition(order, "ship");
    if (order.stockState !== "held") throw new ConflictError(NOT_READY);
    return { next, fields: { stockState: "committing", holdExpiresAt: null } };
  });
  const orgId = ctx.organizationId;
  const options = stockOptions(ctx);

  try {
    await commitLines(orgId, before.lines, options);
  } catch (error) {
    if (isTerminalStockError(error)) {
      logger.error("order stock commit failed: a reservation is no longer held", { orderId });
      throw new ConflictError(COMMIT_FAILED);
    }
    logger.warn("order stock commit failed; the sweep will finish it", { orderId });
    return getStored(orgId, orderId);
  }

  // Lines replaced by an edit whose release failed: nothing ships from them, give them back.
  let released = new Set<string>();
  const stale = before.hasReleasingLines ? (before.releasingLines ?? []) : [];
  if (stale.length > 0) {
    try {
      await releaseLines(orgId, stale, options);
      released = keySet(stale);
    } catch {
      logger.warn("order stale stock release failed; the sweep will finish it", { orderId });
    }
  }

  await finishStock(
    ctx,
    orderId,
    "committing",
    (order) => ({
      lines: order.lines.map((l) => ({ ...l, holdState: "committed" })),
      stockState: "committed",
      ...(released.size > 0
        ? remainingReleasing((order.releasingLines ?? []).filter((l) => !released.has(l.holdKey)))
        : {}),
    }),
    "stock_committed",
  );
  return getStored(orgId, orderId);
}

export async function markDelivered(ctx: OrderCtx, orderId: string): Promise<Order> {
  await applyTransition(ctx, orderId, "deliver", (order) => ({
    next: transition(order, "deliver"),
  }));
  return getStored(ctx.organizationId, orderId);
}

export async function markReturned(ctx: OrderCtx, orderId: string): Promise<Order> {
  await applyTransition(ctx, orderId, "return", (order) => ({
    next: transition(order, "return"),
    detail: RETURN_NOTE,
  }));
  return getStored(ctx.organizationId, orderId);
}

/**
 * Cancels the order (`action: "cancel"`, the default) or expires it (`"expire"`, the sweep: the
 * hold must be at or before now when re-read inside the transaction, else a ConflictError "This
 * order is no longer expired", since an edit may have extended it). Then releases its stock.
 */
export async function cancelOrder(
  ctx: OrderCtx,
  orderId: string,
  reason: string,
  action: "cancel" | "expire" = "cancel",
): Promise<Order> {
  if (action !== "cancel" && action !== "expire") throw invalid("action", "Invalid action");
  const cancelReason = reasonOf(reason, "reason");
  const before = await applyTransition(ctx, orderId, action, (order, now) => {
    const next = transition(order, action);
    if (
      action === "expire" &&
      (order.holdExpiresAt === null || Date.parse(order.holdExpiresAt) > now)
    ) {
      throw new ConflictError(NOT_EXPIRED);
    }
    return {
      next,
      fields: {
        stockState: "releasing",
        holdExpiresAt: null,
        cancelReason,
        cancelledAt: FieldValue.serverTimestamp(),
      },
      detail: cancelReason,
      after: { cancelReason },
    };
  });
  const orgId = ctx.organizationId;

  const toRelease = uniqueLines(before.lines, before.pendingLines, before.releasingLines);
  try {
    await releaseLines(orgId, toRelease, stockOptions(ctx));
  } catch {
    // The cancel stands; the sweep finishes the release (stockState stays "releasing").
    logger.warn("order stock release failed; the sweep will finish it", { orderId });
    return getStored(orgId, orderId);
  }

  const done = keySet(toRelease);
  await finishStock(
    ctx,
    orderId,
    "releasing",
    (order) => ({
      lines: order.lines.map((l) => ({ ...l, holdState: "released" })),
      stockState: "released",
      pendingLines: null,
      // Anything not released here (parked concurrently) stays reachable for the sweep.
      ...remainingReleasing(
        uniqueLines(order.releasingLines, order.pendingLines).filter((l) => !done.has(l.holdKey)),
      ),
    }),
    "stock_released",
  );
  return getStored(orgId, orderId);
}

export async function recordManualRefund(
  ctx: OrderCtx,
  orderId: string,
  reason: string,
): Promise<Order> {
  const refundReason = reasonOf(reason, "reason");
  await applyTransition(ctx, orderId, "refund", (order) => {
    const next = transition(order, "refund");
    return {
      next,
      fields: {
        refund: { reason: refundReason, at: FieldValue.serverTimestamp(), by: ctx.uid },
      },
      detail: refundReason,
      event: { type: "refund_recorded", from: order.paymentStatus, to: next.paymentStatus },
      after: { refundReason },
    };
  });
  return getStored(ctx.organizationId, orderId);
}
