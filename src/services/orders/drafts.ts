/**
 * Draft orders with stock holds. Server-only.
 *
 * CREATE (`createDraftOrder`). Reservations across lines cannot share one transaction (each
 * reserve is its own inventory transaction), so the ORDER OF WRITES is what keeps a crash safe:
 *   1. checks only (customer, idempotency replay, products, cumulative stock, pricing): nothing
 *      is written when any of them fails;
 *   2. Transaction A writes the draft with every line `pending`, `stockState: "pending"` and
 *      `holdExpiresAt` set, plus the order-number lock, the idempotency lock, the `created` event
 *      and the `order.create` audit row;
 *   3. lines are reserved one by one (key `ord_{orderId}_r{revision}_l{i}`);
 *   4. Transaction B marks the lines `held` and `stockState: "held"`.
 * A crash after 2 leaves a draft whose hold expires: the sweep cancels it and releases every key
 * (a never-reserved key counts as free). An idempotent replay of a draft still `pending` resumes
 * steps 3-4 (the keys are idempotent). A reserve failure releases the lines reserved so far
 * and cancels the draft (`stock_unavailable`) in Transaction C; when that release itself fails,
 * Transaction C records `stockState: "releasing"` instead, so the sweep finishes the release.
 *
 * UPDATE (`updateDraftOrder`). Transaction 1 writes the new revision's lines as `pendingLines`
 * (`pending`, new keys), bumps `revision` and extends the hold; they are reserved; Transaction 2
 * swaps them in as `lines` (held), moves the old lines to `releasingLines`
 * (`hasReleasingLines: true`), re-prices, extends the hold and records the `updated` event and
 * audit; then `releasingLines` are released and a final transaction clears them (on failure they
 * stay for the sweep). A failed reserve releases the new lines and clears `pendingLines`; the old
 * lines stay held. An edit needs `stockState: "held"` (a draft whose creator or replay is still
 * reserving is refused). `pendingLines` untouched for `STALE_EDIT_MS` belong to an edit that
 * crashed or failed: the next edit releases them (or moves them to `releasingLines`); fresher
 * ones are an edit in flight and the new edit is refused. A patch without `lines` is one
 * transaction, touches no stock and does not extend the hold.
 *
 * RELEASING LINES. Any stock that may still be reserved for lines no longer in `lines` or
 * `pendingLines` (replaced lines, or lines reserved after their draft ended) is kept in
 * `releasingLines` until released, so no reservation is ever unreachable.
 *
 * Stock calls use `{ maxAttempts: 3 }`: these run inside HTTP requests and AI tool calls.
 */
import "server-only";

import {
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";

import { ConflictError, InsufficientStockError, NotFoundError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { isValidIdSegment } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { assertEntityId, assertOrgCtx } from "@/lib/org-context";
import { writeAuditInTransaction } from "@/lib/security/audit";
import { invalid } from "@/lib/validation-error";
import type { OrgCreateInput } from "@/repositories/base";
import { customerRepo } from "@/repositories/customers";
import { inventoryRepo } from "@/repositories/inventory";
import {
  ORDERS,
  buildOrderEvent,
  idempotencyRef,
  nextOrderNumber,
  orderNumberRef,
  orderRepo,
} from "@/repositories/orders";
import { inventoryRef } from "@/repositories/products";
import {
  MAX_LINE_QUANTITY,
  MAX_ORDER_LINES,
  type Order,
  type OrderDraftPatch,
  type OrderEvent,
  type OrderLine,
  type OrderLineInput,
  type OrderSettings,
  type PaymentMethod,
  type ShippingAddress,
} from "@/schemas/order";
import type { Product } from "@/schemas/product";
import { resolveUnit, retailMinor, stockUnitIds } from "@/services/agents/tools/catalog-access";
import { variantLabelOf } from "@/services/inventory/inventory-query";
import { reserveStock, type StockOptions } from "@/services/inventory/stock";
import { getProduct } from "@/services/products/products";

import { priceOrder, type PricingResult } from "./pricing";
import { getOrderSettings, type OrderCtx } from "./settings";
import {
  OrderExpiredError,
  OrderTransitionError,
  initialPaymentStatus,
  transition,
} from "./state-machine";
import { OrderLineError, holdKey, releaseLines, type OrderLineProblem } from "./stock-holds";

export interface DraftInput {
  customerId: string;
  lines: OrderLineInput[];
  shippingAddress: ShippingAddress;
  paymentMethod: PaymentMethod;
  discountMinor: number;
  notes?: string;
  idempotencyKey: string;
  source: "ai" | "staff";
  conversationId?: string;
}

const STOCK_OPTIONS: StockOptions = { maxAttempts: 3 };
const SERVICE = "Orders";
const CHANGE_IN_PROGRESS = "Another change to this order is in progress";
const NOT_READY = "This order is still being prepared, try again";
/** pendingLines untouched for longer than this belong to an edit that crashed or gave up. */
export const STALE_EDIT_MS = 5 * 60_000;
const HOLD_FAILED = "The stock hold for this order could not be placed";

type LineData = Omit<OrderLine, "holdKey" | "holdState">;

// ---- actor ---------------------------------------------------------------------------------

function createdByOf(ctx: OrderCtx): Order["createdBy"] {
  return ctx.actor?.kind === "ai"
    ? { kind: "ai", agentId: ctx.actor.agentId, sessionId: ctx.actor.sessionId }
    : { kind: "user", uid: ctx.uid };
}

export function eventActorOf(ctx: OrderCtx): OrderEvent["actor"] {
  if (ctx.actor?.kind === "ai") return { kind: "ai", id: ctx.actor.agentId };
  if (ctx.actor?.kind === "system") return { kind: "system", id: ctx.actor.id };
  return { kind: "user", id: ctx.uid };
}

// ---- input checks --------------------------------------------------------------------------

function assertLines(lines: unknown): asserts lines is OrderLineInput[] {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_ORDER_LINES) {
    throw invalid("lines", `Use 1 to ${MAX_ORDER_LINES} items`);
  }
  lines.forEach((line: unknown, i) => {
    const quantity = (line as { quantity?: unknown } | null)?.quantity;
    if (
      typeof quantity !== "number" ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_LINE_QUANTITY
    ) {
      throw invalid(`lines.${i}.quantity`, `Enter a quantity from 1 to ${MAX_LINE_QUANTITY}`);
    }
  });
}

const blankToNull = (s: string | undefined | null): string | null =>
  typeof s === "string" && s.trim() !== "" ? s : null;

// ---- products and stock --------------------------------------------------------------------

async function loadProduct(ctx: OrderCtx, productId: string): Promise<Product | null> {
  try {
    return await getProduct({ organizationId: ctx.organizationId, uid: ctx.uid }, productId);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

/** Available units per `productId__variantId` (0 when missing or of another organization). */
async function readAvailable(
  orgId: string,
  units: ReadonlyArray<{ productId: string; variantId: string }>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (units.length === 0) return out;
  const snaps = await adminDb().getAll(...units.map((u) => inventoryRef(u.productId, u.variantId)));
  snaps.forEach((snap, i) => {
    const u = units[i]!;
    const available = inventoryRepo.fromSnapshot(snap, orgId)?.available;
    out.set(
      `${u.productId}__${u.variantId}`,
      typeof available === "number" && Number.isSafeInteger(available) ? Math.max(0, available) : 0,
    );
  });
  return out;
}

/**
 * Resolves and checks every line against the catalog and current stock (quantities of lines on
 * the same unit are summed). Throws `OrderLineError` listing every failing line; reads only.
 */
async function resolveLines(ctx: OrderCtx, inputs: readonly OrderLineInput[]): Promise<LineData[]> {
  const ids = [...new Set(inputs.map((l) => l.productId))];
  const loaded = await Promise.all(ids.map((id) => loadProduct(ctx, id)));
  const products = new Map(ids.map((id, i) => [id, loaded[i] ?? null]));

  const problems: Array<{ index: number; message: OrderLineProblem }> = [];
  const resolved = inputs.map((line, index) => {
    const product = products.get(line.productId) ?? null;
    if (!product || product.availability !== "active") {
      problems.push({ index, message: "unavailable" });
      return null;
    }
    const unit = resolveUnit(product, line.variantId);
    if (unit.kind === "unit") return { product, variantId: unit.variantId };
    if (unit.kind === "none" && product.variants.length === 0) {
      return { product, variantId: stockUnitIds(product)[0]! };
    }
    problems.push({ index, message: "invalid_variant" });
    return null;
  });

  const units = new Map<string, { productId: string; variantId: string }>();
  for (const r of resolved) {
    if (r)
      units.set(`${r.product.id}__${r.variantId}`, {
        productId: r.product.id,
        variantId: r.variantId,
      });
  }
  const available = await readAvailable(ctx.organizationId, [...units.values()]);
  const wanted = new Map<string, number>();
  resolved.forEach((r, index) => {
    if (!r) return;
    const key = `${r.product.id}__${r.variantId}`;
    const total = (wanted.get(key) ?? 0) + inputs[index]!.quantity;
    wanted.set(key, total);
    if (total > (available.get(key) ?? 0)) problems.push({ index, message: "out_of_stock" });
  });

  if (problems.length > 0) {
    problems.sort((a, b) => a.index - b.index);
    throw new OrderLineError(
      problems.map((p) => ({ path: `lines.${p.index}`, message: p.message })),
    );
  }

  return resolved.map((r, index) => {
    const { product, variantId } = r!;
    const quantity = inputs[index]!.quantity;
    const variant = product.variants.find((v) => v.id === variantId);
    const unitPriceMinor = retailMinor(product);
    return {
      productId: product.id,
      variantId,
      productName: product.name,
      variantLabel:
        product.variants.length > 0 ? variantLabelOf(variantId, product.variants) : null,
      sku: variant?.sku ?? product.sku ?? null,
      unitPriceMinor,
      quantity,
      lineTotalMinor: unitPriceMinor * quantity,
    };
  });
}

interface ReserveFailure {
  index: number;
  error: unknown;
  /** Lines that may hold stock now and must be released (a failed call may still have landed). */
  toRelease: OrderLine[];
}

/** Reserves `lines` in order; stops at the first failure. */
async function reserveInOrder(
  orgId: string,
  lines: readonly OrderLine[],
): Promise<ReserveFailure | null> {
  for (const [index, line] of lines.entries()) {
    let status: string;
    try {
      ({ status } = await reserveStock(
        orgId,
        line.productId,
        line.variantId,
        line.quantity,
        line.holdKey,
        STOCK_OPTIONS,
      ));
    } catch (error) {
      // Releasing the failed line too is harmless (an unknown key is already free) and covers a
      // call whose outcome is unknown.
      return { index, error, toRelease: lines.slice(0, index + 1) };
    }
    if (status !== "reserved") {
      // A replayed key whose reservation already ended: nothing is held for this line.
      return { index, error: new ConflictError(HOLD_FAILED), toRelease: lines.slice(0, index) };
    }
  }
  return null;
}

function publicError(failure: ReserveFailure): unknown {
  return failure.error instanceof InsufficientStockError
    ? new OrderLineError([{ path: `lines.${failure.index}`, message: "out_of_stock" }])
    : failure.error;
}

/** Best effort: true when every line was released, false (logged) otherwise. */
async function tryRelease(orgId: string, orderId: string, lines: readonly OrderLine[]) {
  try {
    await releaseLines(orgId, lines, STOCK_OPTIONS);
    return true;
  } catch {
    logger.warn("order stock release failed", { orderId });
    return false;
  }
}

// ---- reads ---------------------------------------------------------------------------------

async function loadCustomer(orgId: string, customerId: unknown) {
  assertEntityId(customerId);
  const customer = await customerRepo.get(orgId, customerId);
  if (!customer) throw new NotFoundError();
  return customer;
}

/** The order an idempotency lock points at, or null when there is no lock. */
function lockedOrderId(snap: DocumentSnapshot, orgId: string): string | null {
  if (!snap.exists) return null;
  const data = snap.data();
  const orderId: unknown = data?.orderId;
  if (data?.organizationId !== orgId || !isValidIdSegment(orderId)) {
    throw new Error("Order idempotency lock is corrupt");
  }
  return orderId;
}

async function getStored(orgId: string, orderId: string): Promise<Order> {
  const order = await orderRepo.get(orgId, orderId);
  if (!order) throw new Error("Order is missing after a write");
  return order;
}

function isExpired(order: Pick<Order, "holdExpiresAt">, now = Date.now()): boolean {
  return order.holdExpiresAt !== null && Date.parse(order.holdExpiresAt) <= now;
}

/** Only a draft whose hold has not expired can be edited. */
function assertEditable(order: Order): void {
  if (order.status !== "draft") throw new OrderTransitionError();
  if (isExpired(order)) throw new OrderExpiredError();
}

/**
 * An edit needs every line held: while a creator or replay is still reserving (`pending`), an
 * edit releasing the old lines could orphan a reservation that lands afterwards.
 */
function assertHeld(order: Order): void {
  if (order.stockState !== "held") throw new ConflictError(NOT_READY);
}

const holdUntil = (settings: OrderSettings) =>
  Timestamp.fromMillis(Date.now() + settings.draftHoldMinutes * 60_000);

const withHold = (lines: readonly OrderLine[], holdState: OrderLine["holdState"]): OrderLine[] =>
  lines.map((l) => ({ ...l, holdState }));

// ---- releasing lines -----------------------------------------------------------------------

const keySet = (lines: readonly OrderLine[]) => new Set(lines.map((l) => l.holdKey));

/** `existing` plus every line of `added` whose key it does not hold yet. */
function mergeLines(existing: readonly OrderLine[] | null, added: readonly OrderLine[]) {
  const base = existing ?? [];
  const known = keySet(base);
  return [...base, ...added.filter((l) => !known.has(l.holdKey))];
}

/**
 * Records `lines` in the order's `releasingLines` (whatever its status), so the sweep can release
 * them. Throws (logged) when even that write fails.
 */
async function parkLines(orgId: string, orderId: string, lines: readonly OrderLine[]) {
  if (lines.length === 0) return;
  const ref = orderRepo.docRef(orderId);
  try {
    await adminDb().runTransaction(async (tx) => {
      const order = orderRepo.fromSnapshot(await tx.get(ref), orgId);
      if (!order) throw new Error("Order is missing");
      tx.update(ref, {
        releasingLines: mergeLines(order.releasingLines, lines),
        hasReleasingLines: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (error) {
    logger.warn("order stock to release could not be recorded", { orderId });
    throw error;
  }
}

/**
 * Releases `lines`, or parks them in `releasingLines` when that fails. When both fail the error
 * is rethrown: the lines are never silently dropped.
 */
async function releaseOrPark(orgId: string, orderId: string, lines: readonly OrderLine[]) {
  if (await tryRelease(orgId, orderId, lines)) return;
  await parkLines(orgId, orderId, lines);
}

/**
 * Drops released `lines` from `releasingLines` (lines parked meanwhile stay); the flag clears
 * when none remain. Throws when the write fails. Also used by the sweep.
 */
export async function dropReleasingLines(
  orgId: string,
  orderId: string,
  lines: readonly OrderLine[],
): Promise<void> {
  const ref = orderRepo.docRef(orderId);
  const done = keySet(lines);
  await adminDb().runTransaction(async (tx) => {
    const order = orderRepo.fromSnapshot(await tx.get(ref), orgId);
    if (!order || (!order.releasingLines && !order.hasReleasingLines)) return;
    const rest = (order.releasingLines ?? []).filter((l) => !done.has(l.holdKey));
    tx.update(ref, {
      releasingLines: rest.length > 0 ? rest : null,
      hasReleasingLines: rest.length > 0,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

/** `dropReleasingLines`, logged instead of thrown (the sweep retries what is left). */
async function unparkLines(orgId: string, orderId: string, lines: readonly OrderLine[]) {
  try {
    await dropReleasingLines(orgId, orderId, lines);
  } catch {
    logger.warn("order released stock could not be cleared", { orderId });
  }
}

// ---- create --------------------------------------------------------------------------------

/** What Transaction A writes; only `holdExpiresAt` differs from `Order` (a Timestamp). */
type NewOrderData = Omit<OrgCreateInput<Order>, "holdExpiresAt"> & { holdExpiresAt: Timestamp };

export async function createDraftOrder(ctx: OrderCtx, input: DraftInput): Promise<Order> {
  assertOrgCtx(ctx, SERVICE);
  const orgId = ctx.organizationId;
  assertLines(input.lines);

  // 1. The customer must exist in this organization.
  const customer = await loadCustomer(orgId, input.customerId);

  // 2. A replay returns the existing order (resuming its holds if its creator stopped early).
  const idemRef = idempotencyRef(orgId, input.idempotencyKey);
  const replayId = lockedOrderId(await idemRef.get(), orgId);
  if (replayId) return resumeReplay(ctx, replayId);

  // 3-4. Catalog, stock and pricing checks (reads only).
  const resolved = await resolveLines(ctx, input.lines);
  const settings = await getOrderSettings(orgId);
  const pricing = priceOrder({
    lines: resolved,
    discountMinor: input.discountMinor,
    zone: input.shippingAddress.zone,
    settings,
  });

  const orderId = adminDb().collection(ORDERS).doc().id;
  const lines: OrderLine[] = resolved.map((l, i) => ({
    ...l,
    holdKey: holdKey(orderId, 1, i),
    holdState: "pending",
  }));

  // 5. Transaction A: the draft (lines pending, hold set), locks, event and audit.
  const existingId = await adminDb().runTransaction(async (tx) => {
    const raced = lockedOrderId(await tx.get(idemRef), orgId);
    if (raced) return raced;
    const orderNumber = await nextOrderNumber(tx, orgId); // last read; writes follow

    const data: NewOrderData = {
      orderNumber,
      status: "draft",
      source: input.source,
      createdBy: createdByOf(ctx),
      customerId: customer.id,
      customerSnapshot: { name: customer.fullName, phoneE164: customer.phoneE164 },
      shippingAddress: input.shippingAddress,
      lines,
      pendingLines: null,
      releasingLines: null,
      hasReleasingLines: false,
      revision: 1,
      ...pricing,
      currency: "BDT",
      paymentMethod: input.paymentMethod,
      paymentStatus: initialPaymentStatus(input.paymentMethod),
      holdExpiresAt: holdUntil(settings),
      stockState: "pending",
      stockAlert: null,
      conversationId: input.conversationId ?? null,
      notes: blankToNull(input.notes),
      idempotencyKey: input.idempotencyKey,
      confirmedAt: null,
      cancelledAt: null,
      cancelReason: null,
      refund: null,
      allowUnpaidReason: null,
    };
    // The repository types `holdExpiresAt` as its read form (ISO string); it is stored as a
    // Timestamp so the sweep can query it.
    const stored = { ...data, holdExpiresAt: data.holdExpiresAt as unknown as string };
    const order = orderRepo.build(orgId, stored, orderId);
    tx.create(order.ref, order.data);
    tx.create(orderNumberRef(orgId, orderNumber), { organizationId: orgId, orderId });
    tx.create(idemRef, { organizationId: orgId, orderId });
    const event = buildOrderEvent(orgId, {
      orderId,
      type: "created",
      from: null,
      to: "draft",
      actor: eventActorOf(ctx),
      detail: null,
    });
    tx.create(event.ref, event.data);
    writeAuditInTransaction(tx, {
      organizationId: orgId,
      actorUid: ctx.uid,
      action: "order.create",
      resource: "order",
      resourceId: orderId,
      after: {
        orderNumber,
        status: "draft",
        source: input.source,
        paymentMethod: input.paymentMethod,
        lineCount: lines.length,
        totalMinor: pricing.totalMinor,
      },
    });
    return null;
  });
  if (existingId) return resumeReplay(ctx, existingId);

  // 6-7. Reserve the lines, then Transaction B (or C on failure).
  return holdDraft(ctx, orderId, lines, 1);
}

/**
 * The order of an idempotency replay. A draft still `pending` (its creator crashed after
 * Transaction A, or is still running) resumes reserving its stored lines; the keys are
 * idempotent, so lines the creator already reserved are not reserved twice.
 */
async function resumeReplay(ctx: OrderCtx, orderId: string): Promise<Order> {
  const order = await getStored(ctx.organizationId, orderId);
  if (order.status !== "draft" || order.stockState !== "pending" || isExpired(order)) {
    return order;
  }
  return holdDraft(ctx, orderId, order.lines, order.revision);
}

/**
 * Steps 6-7 for a draft whose `lines` (revision `revision`) are stored `pending`: reserve them in
 * order, then Transaction B marks them held. A reserve failure releases what was reserved and
 * cancels the draft (Transaction C) before rethrowing.
 */
async function holdDraft(
  ctx: OrderCtx,
  orderId: string,
  lines: readonly OrderLine[],
  revision: number,
): Promise<Order> {
  const orgId = ctx.organizationId;
  const failure = await reserveInOrder(orgId, lines);
  if (failure) {
    // A concurrent creator or replay may already have held these very lines: then they are live
    // holds of a good order, not leftovers to release, and the order must not be cancelled.
    const live = await orderRepo.get(orgId, orderId);
    if (live?.status === "draft" && live.revision === revision && live.stockState === "held") {
      return live;
    }
    const released = await tryRelease(orgId, orderId, failure.toRelease);
    await cancelUnheldDraft(ctx, orderId, revision, released);
    throw publicError(failure);
  }

  // Transaction B: every line held.
  const ref = orderRepo.docRef(orderId);
  const outcome = await adminDb().runTransaction(async (tx) => {
    const order = orderRepo.fromSnapshot(await tx.get(ref), orgId);
    if (!order || order.status !== "draft") return "ended" as const;
    if (order.revision !== revision) return "replaced" as const;
    if (order.stockState === "held") return "held" as const; // a concurrent replay got there first
    if (order.stockState !== "pending") return "ended" as const;
    tx.update(ref, {
      lines: withHold(order.lines, "held"),
      stockState: "held",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return "held" as const;
  });
  if (outcome === "held") return getStored(orgId, orderId);

  // These lines no longer belong to a live draft (it ended, or an edit replaced them) and may
  // have been reserved after they were released: give the stock back, or keep it reachable.
  await releaseOrPark(orgId, orderId, lines);
  if (outcome === "replaced") return getStored(orgId, orderId);
  throw new OrderExpiredError();
}

/**
 * Transaction C: cancels a draft whose lines could not all be reserved. `released` says whether
 * the compensation release succeeded; when it did not, `stockState: "releasing"` leaves the
 * release to the sweep. Only a draft still `pending` at this revision is cancelled: one already
 * held (by a concurrent replay) or whose lines an edit replaced is left alone. Failures are
 * logged (order id only), never thrown: the caller rethrows the original error, and an
 * uncancelled draft still expires.
 */
async function cancelUnheldDraft(
  ctx: OrderCtx,
  orderId: string,
  revision: number,
  released: boolean,
) {
  const orgId = ctx.organizationId;
  const ref = orderRepo.docRef(orderId);
  try {
    await adminDb().runTransaction(async (tx) => {
      const order = orderRepo.fromSnapshot(await tx.get(ref), orgId);
      if (
        !order ||
        order.status !== "draft" ||
        order.revision !== revision ||
        order.stockState !== "pending"
      ) {
        return;
      }
      const next = transition(order, "cancel");
      tx.update(ref, {
        status: next.status,
        paymentStatus: next.paymentStatus,
        cancelReason: "stock_unavailable",
        cancelledAt: FieldValue.serverTimestamp(),
        lines: released ? withHold(order.lines, "released") : order.lines,
        stockState: released ? "released" : "releasing",
        holdExpiresAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      const event = buildOrderEvent(orgId, {
        orderId,
        type: "status_changed",
        from: order.status,
        to: next.status,
        actor: eventActorOf(ctx),
        detail: "stock_unavailable",
      });
      tx.create(event.ref, event.data);
      writeAuditInTransaction(tx, {
        organizationId: orgId,
        actorUid: ctx.uid,
        action: "order.cancel",
        resource: "order",
        resourceId: orderId,
        before: { status: order.status },
        after: { status: next.status, cancelReason: "stock_unavailable" },
      });
    });
  } catch {
    logger.warn("order draft could not be cancelled after a failed hold", { orderId });
  }
}

// ---- update --------------------------------------------------------------------------------

const PATCH_FIELDS = [
  "lines",
  "shippingAddress",
  "paymentMethod",
  "discountMinor",
  "notes",
] as const;

/**
 * Every field a patch changes besides lines/stock, priced against `lines`. The hold is extended
 * only when the lines change (`extendHold`).
 */
function patchedFields(
  order: Order,
  patch: OrderDraftPatch,
  lines: readonly OrderLine[],
  settings: OrderSettings,
  extendHold: boolean,
): { fields: Record<string, unknown>; pricing: PricingResult } {
  const shippingAddress = patch.shippingAddress ?? order.shippingAddress;
  const paymentMethod = patch.paymentMethod ?? order.paymentMethod;
  const pricing = priceOrder({
    lines: [...lines],
    discountMinor: patch.discountMinor ?? order.discountMinor,
    zone: shippingAddress.zone,
    settings,
  });
  return {
    pricing,
    fields: {
      shippingAddress,
      paymentMethod,
      paymentStatus: initialPaymentStatus(paymentMethod),
      ...pricing,
      notes: patch.notes === undefined ? order.notes : blankToNull(patch.notes),
      ...(extendHold ? { holdExpiresAt: holdUntil(settings) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
  };
}

const pendingKeys = (order: Pick<Order, "pendingLines">) =>
  order.pendingLines ? order.pendingLines.map((l) => l.holdKey).join(",") : null;

export async function updateDraftOrder(
  ctx: OrderCtx,
  orderId: string,
  patch: OrderDraftPatch,
): Promise<Order> {
  assertOrgCtx(ctx, SERVICE);
  assertEntityId(orderId);
  const orgId = ctx.organizationId;
  const changed = PATCH_FIELDS.filter((k) => patch?.[k] !== undefined);
  if (changed.length === 0) throw invalid("patch", "At least one field is required");
  if (patch.lines !== undefined) assertLines(patch.lines);

  const current = await orderRepo.get(orgId, orderId);
  if (!current) throw new NotFoundError();
  assertEditable(current);
  assertHeld(current);
  // pendingLines are an edit in flight unless untouched for STALE_EDIT_MS.
  if (current.pendingLines && Date.now() - Date.parse(current.updatedAt) <= STALE_EDIT_MS) {
    throw new ConflictError(CHANGE_IN_PROGRESS);
  }
  const settings = await getOrderSettings(orgId);
  const ref = orderRepo.docRef(orderId);
  const detail = changed.join(", ");

  // Stale pendingLines (an earlier edit crashed or could not release them): release them, or
  // park them in releasingLines, so this edit can replace them. Throws if neither works.
  const stale = pendingKeys(current);
  if (current.pendingLines) await releaseOrPark(orgId, orderId, current.pendingLines);
  /** The transaction must see exactly the pendingLines handled above (else a concurrent edit). */
  const assertPendingUnchanged = (order: Order) => {
    if (pendingKeys(order) !== stale) throw new ConflictError(CHANGE_IN_PROGRESS);
  };

  const record = (tx: Transaction, before: Order, revision: number, pricing: PricingResult) => {
    const event = buildOrderEvent(orgId, {
      orderId,
      type: "updated",
      from: null,
      to: null,
      actor: eventActorOf(ctx),
      detail,
    });
    tx.create(event.ref, event.data);
    writeAuditInTransaction(tx, {
      organizationId: orgId,
      actorUid: ctx.uid,
      action: "order.update",
      resource: "order",
      resourceId: orderId,
      before: { revision: before.revision, totalMinor: before.totalMinor },
      after: { revision, totalMinor: pricing.totalMinor, changed },
    });
  };

  // No lines: one transaction, no stock steps, the hold is not extended.
  if (patch.lines === undefined) {
    await adminDb().runTransaction(async (tx) => {
      const order = orderRepo.fromSnapshot(await tx.get(ref), orgId);
      if (!order) throw new NotFoundError();
      assertEditable(order);
      assertHeld(order);
      assertPendingUnchanged(order);
      const { fields, pricing } = patchedFields(order, patch, order.lines, settings, false);
      tx.update(ref, { ...fields, ...(stale ? { pendingLines: null } : {}) });
      record(tx, order, order.revision, pricing);
    });
    return getStored(orgId, orderId);
  }

  // Checks first (reads only): catalog, stock, pricing.
  const resolved = await resolveLines(ctx, patch.lines);
  const revision = current.revision + 1;
  const newLines: OrderLine[] = resolved.map((l, i) => ({
    ...l,
    holdKey: holdKey(orderId, revision, i),
    holdState: "pending",
  }));
  patchedFields(current, patch, newLines, settings, true); // fail fast on pricing

  // Transaction 1: the new revision's lines as pendingLines; the hold is extended.
  await adminDb().runTransaction(async (tx) => {
    const order = orderRepo.fromSnapshot(await tx.get(ref), orgId);
    if (!order) throw new NotFoundError();
    assertEditable(order);
    assertHeld(order);
    if (order.revision !== current.revision) throw new ConflictError(CHANGE_IN_PROGRESS);
    assertPendingUnchanged(order);
    tx.update(ref, {
      pendingLines: newLines,
      revision,
      holdExpiresAt: holdUntil(settings),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  const failure = await reserveInOrder(orgId, newLines);
  if (failure) {
    const released = await tryRelease(orgId, orderId, failure.toRelease);
    // When the release failed, pendingLines stay: a later edit, a cancel or the sweep frees them.
    if (released) await clearPendingLines(orgId, orderId, revision);
    throw publicError(failure);
  }

  // Transaction 2: swap in the new lines (held), move the old ones to releasingLines, re-price,
  // extend the hold, event and audit.
  const swapped = await adminDb().runTransaction(async (tx) => {
    const order = orderRepo.fromSnapshot(await tx.get(ref), orgId);
    if (!order || order.status !== "draft" || order.revision !== revision || !order.pendingLines) {
      return { ok: false as const, draft: order?.status === "draft" };
    }
    const held = withHold(newLines, "held");
    const releasing = mergeLines(order.releasingLines, order.lines);
    const { fields, pricing } = patchedFields(order, patch, held, settings, true);
    tx.update(ref, {
      ...fields,
      lines: held,
      pendingLines: null,
      stockState: "held",
      releasingLines: releasing,
      hasReleasingLines: true,
    });
    record(tx, order, revision, pricing);
    return { ok: true as const, releasing };
  });
  if (!swapped.ok) {
    // The draft ended (expired and swept) or another edit took over while these lines were
    // reserved: give them back, or keep them reachable.
    await releaseOrPark(orgId, orderId, newLines);
    throw swapped.draft ? new ConflictError(CHANGE_IN_PROGRESS) : new OrderTransitionError();
  }

  // The replaced lines (and anything parked earlier) no longer hold anything for this order.
  // If the release fails they stay in releasingLines for the sweep.
  if (await tryRelease(orgId, orderId, swapped.releasing)) {
    await unparkLines(orgId, orderId, swapped.releasing);
  }
  return getStored(orgId, orderId);
}

/** Clears the pendingLines of a failed edit (revision `revision`); logged, never thrown. */
async function clearPendingLines(orgId: string, orderId: string, revision: number) {
  const ref = orderRepo.docRef(orderId);
  try {
    await adminDb().runTransaction(async (tx) => {
      const order = orderRepo.fromSnapshot(await tx.get(ref), orgId);
      if (!order || order.revision !== revision || order.pendingLines === null) return;
      tx.update(ref, { pendingLines: null, updatedAt: FieldValue.serverTimestamp() });
    });
  } catch {
    logger.warn("order draft edit could not clear its pending lines", { orderId });
  }
}
