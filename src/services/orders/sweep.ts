/**
 * Hold-expiry sweep: the safety net for everything drafts.ts and lifecycle.ts leave unfinished.
 * Server-only. Run by the cron route `GET /api/cron/orders/expire`.
 *
 * The sweep is CROSS-ORGANIZATION by design: its queries have no `organizationId` clause, and
 * each order is handled with the system actor of the organization stored on that order
 * (`uid: "system:sweep"`, actor `{ kind: "system", id: "sweep" }`).
 *
 * Passes, in order (each pages through its query in batches of `batch`, default 50):
 *   1. expired holds: `status == draft|confirmed AND holdExpiresAt <= now`. Confirmed orders are
 *      expired only while `awaiting_payment` / `failed` (COD has no hold). `cancelOrder(...,
 *      "expire")` re-checks inside its transaction; a hold extended meanwhile (an edit) or a
 *      status that moved on is a skip, not an error. It releases lines, pendingLines and
 *      releasingLines itself.
 *   2. stuck releases: `stockState == releasing AND updatedAt <= now - 5 min` -> release every
 *      key, then the same T2 as `cancelOrder` (`finishRelease`).
 *   3. stuck commits: `stockState == committing AND updatedAt <= now - 5 min` -> commit, then the
 *      same T2 as `markShipped` (`finishCommit`). A terminal commit failure (a released or
 *      unknown key: corruption) is not retried forever: the order gets `stockAlert:
 *      "commit_failed"` (and a note event), an error is logged, and later sweeps skip it.
 *   4. cancelled orders still `pending`: `stockState == pending AND updatedAt <= now - 5 min`,
 *      `status == cancelled` filtered in memory -> marked `releasing`, then as pass 2. A draft
 *      still `pending` whose hold has not expired is left alone (its replay or expiry handles it).
 *   5. parked lines: `hasReleasingLines == true` (single-field query), `updatedAt <= now - 5 min`
 *      filtered in memory -> release `releasingLines`, then drop only the released keys (lines
 *      parked meanwhile stay; the flag clears when none remain). Orders still `releasing` belong
 *      to pass 2.
 * The 5-minute age keeps the sweep off steps that are still running (they finish in seconds).
 *
 * Every order is isolated: a failure counts in `errors`, is logged with the order id only, and
 * never stops the others. Counts: `expired` (pass 1), `released` (passes 2, 4, 5), `committed`
 * (pass 3).
 *
 * BOUNDED RUNTIME. No new order is started after `SWEEP_BUDGET_MS` of wall time; the result
 * says what was done, and the next run continues. Stock calls use `{ maxAttempts: 3 }`.
 */
import "server-only";

import {
  FieldPath,
  FieldValue,
  Timestamp,
  type Query,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { isValidIdSegment } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { invalid } from "@/lib/validation-error";
import { ORDERS, buildOrderEvent, orderRepo } from "@/repositories/orders";
import type { Order, PaymentStatus } from "@/schemas/order";

import { dropReleasingLines, eventActorOf } from "./drafts";
import {
  OrderNotExpiredError,
  STOCK_OPTIONS,
  cancelOrder,
  finishCommit,
  finishRelease,
  isTerminalStockError,
  linesToRelease,
} from "./lifecycle";
import type { OrderCtx } from "./settings";
import { OrderTransitionError } from "./state-machine";
import { commitLines, releaseLines } from "./stock-holds";
import { reconcilePaymentAttempts } from "@/services/payments/reconciler";

export interface SweepResult {
  expired: number;
  released: number;
  committed: number;
  errors: number;
  reconciled?: number;
}

/** Wall time after which the sweep starts no new order. */
export const SWEEP_BUDGET_MS = 45_000;
const DEFAULT_BATCH = 50;
const MAX_BATCH = 500;
/** A stock step untouched this long was interrupted (a running one finishes in seconds). */
const STUCK_MS = 5 * 60_000;
const EXPIRE_REASON = "expired";
const EXPIRABLE_PAYMENT: ReadonlySet<PaymentStatus> = new Set(["awaiting_payment", "failed"]);
const COMMIT_FAILED_NOTE =
  "The stock for this order could not be committed; fix the inventory manually";

/** done: counted; skip: nothing to do; failed: already logged, counted in `errors`. */
type Outcome = "done" | "skip" | "failed";
type Counter = Exclude<keyof SweepResult, "errors">;

interface Run {
  deadline: number;
  batch: number;
  result: SweepResult;
}

const orders = () => adminDb().collection(ORDERS);

function systemCtx(order: Order): OrderCtx {
  if (!isValidIdSegment(order.organizationId)) throw new Error("Order organization is corrupt");
  return {
    organizationId: order.organizationId,
    uid: "system:sweep",
    actor: { kind: "system", id: "sweep" },
  };
}

const outOfTime = (run: Run) => Date.now() >= run.deadline;

/** Pages through `query` and handles each order, isolated, until the query or the time ends. */
async function scan(
  run: Run,
  pass: string,
  query: Query,
  counter: Counter,
  handle: (order: Order) => Promise<Outcome>,
): Promise<void> {
  let after: QueryDocumentSnapshot | undefined;
  while (!outOfTime(run)) {
    let page;
    try {
      page = await (after ? query.startAfter(after) : query).limit(run.batch).get();
    } catch {
      // A failed query (outage, missing index) ends this pass only; the next passes still run.
      run.result.errors++;
      logger.warn("order sweep query failed", { pass });
      return;
    }
    for (const doc of page.docs) {
      if (outOfTime(run)) return;
      try {
        const order = orderRepo.unsafeFromSnapshot(doc);
        if (!order) continue;
        const outcome = await handle(order);
        if (outcome === "done") run.result[counter]++;
        if (outcome === "failed") run.result.errors++;
      } catch {
        run.result.errors++;
        logger.warn("order sweep failed for an order", { orderId: doc.id });
      }
    }
    if (page.docs.length < run.batch) return;
    after = page.docs[page.docs.length - 1];
  }
}

// ---- pass 1: expired holds -------------------------------------------------------------------

async function expire(order: Order): Promise<Outcome> {
  if (order.status === "confirmed" && !EXPIRABLE_PAYMENT.has(order.paymentStatus)) return "skip";
  linesToRelease(order); // a corrupt order is refused before anything is written
  try {
    await cancelOrder(systemCtx(order), order.id, EXPIRE_REASON, "expire");
    return "done";
  } catch (error) {
    // The hold was extended, or the order moved on (confirmed, paid) after the query.
    if (error instanceof OrderNotExpiredError || error instanceof OrderTransitionError) {
      return "skip";
    }
    throw error;
  }
}

// ---- passes 2 and 4: stuck releases ----------------------------------------------------------

async function release(order: Order): Promise<Outcome> {
  if (order.stockState !== "releasing") return "skip";
  const ctx = systemCtx(order);
  const lines = linesToRelease(order);
  await releaseLines(ctx.organizationId, lines, STOCK_OPTIONS);
  await finishRelease(ctx, order.id, lines);
  return "done";
}

/** A cancelled order whose stock is still `pending`: marked `releasing`, then released. */
async function releaseCancelledPending(order: Order): Promise<Outcome> {
  if (order.status !== "cancelled" || order.stockState !== "pending") return "skip";
  const ctx = systemCtx(order);
  linesToRelease(order);
  const ref = orderRepo.docRef(order.id);
  const marked = await adminDb().runTransaction(async (tx) => {
    const current = orderRepo.fromSnapshot(await tx.get(ref), ctx.organizationId);
    if (!current || current.status !== "cancelled" || current.stockState !== "pending") {
      return null;
    }
    tx.update(ref, { stockState: "releasing", updatedAt: FieldValue.serverTimestamp() });
    return { ...current, stockState: "releasing" as const };
  });
  return marked ? release(marked) : "skip";
}

// ---- pass 3: stuck commits -------------------------------------------------------------------

async function commit(order: Order): Promise<Outcome> {
  if (order.stockState !== "committing" || order.stockAlert) return "skip";
  if (!Array.isArray(order.lines)) throw new Error("Order lines are corrupt");
  const ctx = systemCtx(order);
  try {
    await commitLines(ctx.organizationId, order.lines, STOCK_OPTIONS);
  } catch (error) {
    if (!isTerminalStockError(error)) throw error; // busy or outage: the next run retries
    await markCommitFailed(ctx, order.id);
    logger.error("order stock commit failed: a reservation is no longer held", {
      orderId: order.id,
    });
    return "failed";
  }
  await finishCommit(ctx, order);
  return "done";
}

/** `stockAlert: "commit_failed"` plus a note event, so later sweeps skip the order. */
async function markCommitFailed(ctx: OrderCtx, orderId: string): Promise<void> {
  const ref = orderRepo.docRef(orderId);
  await adminDb().runTransaction(async (tx) => {
    const order = orderRepo.fromSnapshot(await tx.get(ref), ctx.organizationId);
    if (!order || order.stockState !== "committing" || order.stockAlert) return;
    tx.update(ref, { stockAlert: "commit_failed", updatedAt: FieldValue.serverTimestamp() });
    const event = buildOrderEvent(ctx.organizationId, {
      orderId,
      type: "note",
      from: null,
      to: null,
      actor: eventActorOf(ctx),
      detail: COMMIT_FAILED_NOTE,
    });
    tx.create(event.ref, event.data);
  });
}

// ---- pass 5: parked releasingLines -----------------------------------------------------------

function releaseParked(cutoff: number) {
  return async (order: Order): Promise<Outcome> => {
    if (!order.hasReleasingLines || order.stockState === "releasing") return "skip";
    if (!(Date.parse(order.updatedAt) <= cutoff)) return "skip";
    const lines = order.releasingLines ?? [];
    if (!Array.isArray(lines)) throw new Error("Order releasing lines are corrupt");
    const ctx = systemCtx(order);
    await releaseLines(ctx.organizationId, lines, STOCK_OPTIONS);
    await dropReleasingLines(ctx.organizationId, order.id, lines);
    return "done";
  };
}

// ---- the sweep -------------------------------------------------------------------------------

export async function sweepOrders(
  now: Date = new Date(),
  opts: { batch?: number; budgetMs?: number } = {},
): Promise<SweepResult> {
  const batch = opts.batch ?? DEFAULT_BATCH;
  if (!Number.isInteger(batch) || batch < 1 || batch > MAX_BATCH) {
    throw invalid("batch", `Use 1 to ${MAX_BATCH}`);
  }
  const run: Run = {
    deadline: Date.now() + (opts.budgetMs ?? SWEEP_BUDGET_MS),
    batch,
    result: { expired: 0, released: 0, committed: 0, errors: 0 },
  };
  const nowTs = Timestamp.fromDate(now);
  const cutoffMs = now.getTime() - STUCK_MS;
  const cutoff = Timestamp.fromMillis(cutoffMs);
  const stuck = (stockState: Order["stockState"]) =>
    orders()
      .where("stockState", "==", stockState)
      .where("updatedAt", "<=", cutoff)
      .orderBy("updatedAt", "asc");

  for (const status of ["draft", "confirmed"] as const) {
    await scan(
      run,
      `expire_${status}`,
      orders()
        .where("status", "==", status)
        .where("holdExpiresAt", "<=", nowTs)
        .orderBy("holdExpiresAt", "asc"),
      "expired",
      expire,
    );
  }
  await scan(run, "releasing", stuck("releasing"), "released", release);
  await scan(run, "committing", stuck("committing"), "committed", commit);
  await scan(run, "cancelled_pending", stuck("pending"), "released", releaseCancelledPending);
  await scan(
    run,
    "releasing_lines",
    orders().where("hasReleasingLines", "==", true).orderBy(FieldPath.documentId(), "asc"),
    "released",
    releaseParked(cutoffMs),
  );

  // ---- pass 6: unverified payment attempts reconciler ------------------------------------------
  const remainingBudget = run.deadline - Date.now();
  if (remainingBudget > 2000) {
    const paymentResult = await reconcilePaymentAttempts(run.batch, remainingBudget);
    run.result.expired += paymentResult.expired;
    run.result.errors += paymentResult.errors;
    run.result.reconciled = paymentResult.reconciled;
  }

  return run.result;
}
