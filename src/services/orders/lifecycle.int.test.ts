import { randomUUID } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { ConflictError, InventoryBusyError, NotFoundError, ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { customerInputSchema } from "@/schemas/customer";
import { shippingAddressSchema, type OrderLine, type PaymentMethod } from "@/schemas/order";
import { productInputSchema, type Product } from "@/schemas/product";
import { createCustomer } from "@/services/crm/customers";
import { adjustStock } from "@/services/inventory/stock";
import { createProduct } from "@/services/products/products";

import { createDraftOrder, updateDraftOrder, type DraftInput } from "./drafts";
import {
  cancelOrder,
  confirmOrder,
  markDelivered,
  markReturned,
  markShipped,
  recordManualRefund,
  startProcessing,
} from "./lifecycle";
import type { OrderCtx } from "./settings";
import { OrderExpiredError, OrderTransitionError } from "./state-machine";
import { holdKey } from "./stock-holds";

// Failure seams: the in-transaction audit write can throw (nothing in that transaction may
// survive), a release can throw, and a commit can throw a chosen error.
const audit = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/security/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/audit")>();
  return {
    ...actual,
    writeAuditInTransaction: (...args: Parameters<typeof actual.writeAuditInTransaction>) => {
      if (audit.fail) throw new Error("audit unavailable");
      return actual.writeAuditInTransaction(...args);
    },
  };
});

const seam = vi.hoisted(() => ({
  failRelease: false,
  commitError: null as null | (() => unknown),
}));
vi.mock("@/services/inventory/stock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/inventory/stock")>();
  return {
    ...actual,
    releaseStock: async (...args: Parameters<typeof actual.releaseStock>) => {
      if (seam.failRelease) throw new Error("release unavailable");
      return actual.releaseStock(...args);
    },
    commitStock: async (...args: Parameters<typeof actual.commitStock>) => {
      if (seam.commitError) throw seam.commitError();
      return actual.commitStock(...args);
    },
  };
});

const actualStock = await vi.importActual<typeof import("@/services/inventory/stock")>(
  "@/services/inventory/stock",
);

const db = () => adminDb();
const orgs: string[] = [];
function newCtx() {
  const organizationId = `org-${randomUUID()}`;
  orgs.push(organizationId);
  return { organizationId, uid: `uid-${randomUUID()}` };
}
type Ctx = ReturnType<typeof newCtx>;
const sweepCtx = (ctx: Ctx): OrderCtx => ({
  organizationId: ctx.organizationId,
  uid: "system:sweep",
  actor: { kind: "system", id: "sweep" },
});

let phoneCounter = 0;
const phone = () => `01713${String(1000000 + ++phoneCounter).slice(1)}`;

async function seedProduct(ctx: Ctx, stockUnits: number): Promise<Product> {
  const product = await createProduct(
    ctx,
    productInputSchema.parse({
      name: `Shirt ${randomUUID().slice(0, 6)}`,
      sku: `sku-${randomUUID().slice(0, 8)}`,
      regularPriceMinor: 50000,
      availability: "active",
      variants: [],
    }),
  );
  await adjustStock(ctx, product.id, "default", { delta: stockUnits, reason: "seed" });
  return product;
}

const address = () =>
  shippingAddressSchema.parse({
    recipientName: "Rahim",
    phone: "01712345678",
    line1: "House 1, Road 2",
    zone: "inside_dhaka",
  });

/** A held draft of `quantity` units of a fresh product with 10 in stock. */
async function seedDraft(ctx: Ctx, opts: { method?: PaymentMethod; quantity?: number } = {}) {
  const customer = await createCustomer(
    ctx,
    customerInputSchema.parse({ fullName: "Md. Rahim", phone: phone() }),
  );
  const product = await seedProduct(ctx, 10);
  const input: DraftInput = {
    customerId: customer.id,
    lines: [{ productId: product.id, quantity: opts.quantity ?? 2 }],
    shippingAddress: address(),
    paymentMethod: opts.method ?? "cod",
    discountMinor: 0,
    idempotencyKey: `key-${randomUUID()}`,
    source: "staff",
  };
  const order = await createDraftOrder(ctx, input);
  expect(order.stockState).toBe("held");
  return { order, product, customer };
}

const invDoc = (productId: string, variantId = "default") =>
  db().collection("inventory").doc(`${productId}__${variantId}`);
async function counts(productId: string) {
  const d = (await invDoc(productId).get()).data()!;
  return { onHand: d.onHand as number, reserved: d.reserved as number };
}
async function reservationStatus(productId: string, key: string) {
  return (await invDoc(productId).collection("reservations").doc(key).get()).get("status");
}
async function docsOf(collection: string, organizationId: string) {
  return (await db().collection(collection).where("organizationId", "==", organizationId).get())
    .docs;
}
const orderDoc = (id: string) => db().collection("orders").doc(id);
const rawOrder = async (id: string) => (await orderDoc(id).get()).data()!;

async function auditActions(ctx: Ctx, orderId: string) {
  return (await docsOf("auditLogs", ctx.organizationId))
    .filter((d) => d.get("resource") === "order" && d.get("resourceId") === orderId)
    .map((d) => d.get("action") as string)
    .sort();
}
async function eventsOf(ctx: Ctx, orderId: string) {
  return (await docsOf("orderEvents", ctx.organizationId))
    .filter((d) => d.get("orderId") === orderId)
    .map((d) => d.data());
}
const statusEvents = async (ctx: Ctx, orderId: string) =>
  (await eventsOf(ctx, orderId)).filter((e) => e.type === "status_changed");

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error("expected a rejection");
    },
    (err: unknown) => err,
  );
}

/** Stored timestamps are backdated instead of faking `Date` (gRPC deadlines need a real clock). */
const ago = (ms: number) => Timestamp.fromMillis(Date.now() - ms);
const expireHold = (orderId: string) => orderDoc(orderId).update({ holdExpiresAt: ago(60_000) });
const markPaid = (orderId: string) => orderDoc(orderId).update({ paymentStatus: "paid" });

let warn: MockInstance<typeof logger.warn>;
let error: MockInstance<typeof logger.error>;
let warnings: "none" | "expected" = "none";

beforeEach(() => {
  audit.fail = false;
  seam.failRelease = false;
  seam.commitError = null;
  warnings = "none";
  warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
  error = vi.spyOn(logger, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (warnings === "none") expect(warn).not.toHaveBeenCalled();
  if (warnings === "expected") expect(warn).toHaveBeenCalled();
  warn.mockRestore();
  error.mockRestore();
});

afterAll(async () => {
  for (const org of orgs) {
    for (const d of await docsOf("inventory", org)) await db().recursiveDelete(d.ref);
    for (const col of [
      "orders",
      "orderEvents",
      "orderCounters",
      "orderNumbers",
      "orderIdempotency",
      "auditLogs",
      "products",
      "productSkus",
      "productSlugs",
      "customers",
      "customerPhones",
    ]) {
      const docs = await docsOf(col, org);
      await Promise.all(docs.map((d) => d.ref.delete()));
    }
  }
});

describe("confirmOrder", () => {
  it("confirms a COD draft: cod_pending, hold cleared, stock stays reserved", async () => {
    const ctx = newCtx();
    const { order, product } = await seedDraft(ctx);

    const confirmed = await confirmOrder(ctx, order.id);

    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.paymentStatus).toBe("cod_pending");
    expect(confirmed.holdExpiresAt).toBeNull();
    expect(confirmed.confirmedAt).toEqual(expect.any(String));
    expect(confirmed.stockState).toBe("held");
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 2 });

    const events = await statusEvents(ctx, order.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      from: "draft",
      to: "confirmed",
      actor: { kind: "user", id: ctx.uid },
    });
    expect(await auditActions(ctx, order.id)).toEqual(["order.confirm", "order.create"]);
  });

  it("confirms an online draft: awaiting_payment with a hold of paymentHoldHours (24 h)", async () => {
    const ctx = newCtx();
    const { order } = await seedDraft(ctx, { method: "online" });

    const before = Date.now();
    const confirmed = await confirmOrder(ctx, order.id);
    const after = Date.now();

    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.paymentStatus).toBe("awaiting_payment");
    const hold = Date.parse(confirmed.holdExpiresAt!);
    expect(hold).toBeGreaterThanOrEqual(before + 24 * 3_600_000);
    expect(hold).toBeLessThanOrEqual(after + 24 * 3_600_000);
  });

  it("confirm after the sweep cancelled the draft fails with a transition error", async () => {
    const ctx = newCtx();
    const { order } = await seedDraft(ctx);
    await expireHold(order.id);
    await cancelOrder(sweepCtx(ctx), order.id, "expired", "expire");

    expect(await rejection(confirmOrder(ctx, order.id))).toBeInstanceOf(OrderTransitionError);
  });

  it("refuses a draft whose hold is past (OrderExpiredError) and writes nothing", async () => {
    const ctx = newCtx();
    const { order } = await seedDraft(ctx);
    await expireHold(order.id);

    expect(await rejection(confirmOrder(ctx, order.id))).toBeInstanceOf(OrderExpiredError);
    expect((await rawOrder(order.id)).status).toBe("draft");
    expect(await statusEvents(ctx, order.id)).toHaveLength(0);
  });

  it("refuses a draft whose stock is not held yet, or that has an edit in flight", async () => {
    const ctx = newCtx();
    const { order } = await seedDraft(ctx);

    await orderDoc(order.id).update({ stockState: "pending" });
    const notReady = await rejection(confirmOrder(ctx, order.id));
    expect(notReady).toBeInstanceOf(ConflictError);
    expect((notReady as Error).message).toBe("This order is still being prepared, try again");

    await orderDoc(order.id).update({ stockState: "held", pendingLines: order.lines });
    expect(await rejection(confirmOrder(ctx, order.id))).toBeInstanceOf(ConflictError);
    expect((await rawOrder(order.id)).status).toBe("draft");
  });

  it("an order of another organization is NotFound", async () => {
    const ctx = newCtx();
    const { order } = await seedDraft(ctx);
    const other = newCtx();
    expect(await rejection(confirmOrder(other, order.id))).toBeInstanceOf(NotFoundError);
    expect(await rejection(confirmOrder(ctx, "no-such-order"))).toBeInstanceOf(NotFoundError);
  });
});

describe("startProcessing", () => {
  it("refuses an unpaid online order; with allowUnpaidReason it processes and stores the reason", async () => {
    const ctx = newCtx();
    const { order } = await seedDraft(ctx, { method: "online" });
    await confirmOrder(ctx, order.id);

    expect(await rejection(startProcessing(ctx, order.id))).toBeInstanceOf(OrderTransitionError);

    const processing = await startProcessing(ctx, order.id, {
      allowUnpaidReason: "Customer paid by bank transfer",
    });
    expect(processing.status).toBe("processing");
    expect(processing.allowUnpaidReason).toBe("Customer paid by bank transfer");
    expect(processing.holdExpiresAt).toBeNull();
    expect(await auditActions(ctx, order.id)).toEqual([
      "order.confirm",
      "order.create",
      "order.process",
    ]);
  });

  it("processes a COD order without a reason", async () => {
    const ctx = newCtx();
    const { order } = await seedDraft(ctx);
    await confirmOrder(ctx, order.id);
    const processing = await startProcessing(ctx, order.id);
    expect(processing.status).toBe("processing");
    expect(processing.allowUnpaidReason).toBeNull();
  });

  it("refuses an online order whose payment hold expired", async () => {
    const ctx = newCtx();
    const { order } = await seedDraft(ctx, { method: "online" });
    await confirmOrder(ctx, order.id);
    await expireHold(order.id);
    expect(
      await rejection(startProcessing(ctx, order.id, { allowUnpaidReason: "Paid in cash" })),
    ).toBeInstanceOf(OrderExpiredError);
  });

  it("rejects a blank allowUnpaidReason", async () => {
    const ctx = newCtx();
    const { order } = await seedDraft(ctx, { method: "online" });
    await confirmOrder(ctx, order.id);
    expect(
      await rejection(startProcessing(ctx, order.id, { allowUnpaidReason: "   " })),
    ).toBeInstanceOf(ValidationError);
  });
});

describe("markShipped", () => {
  it("commits the stock once: onHand and reserved both drop; shipping again throws, stock unchanged", async () => {
    const ctx = newCtx();
    const { order, product } = await seedDraft(ctx, { quantity: 3 });
    await confirmOrder(ctx, order.id);

    const shipped = await markShipped(ctx, order.id);

    expect(shipped.status).toBe("shipped");
    expect(shipped.stockState).toBe("committed");
    expect(shipped.lines.map((l) => l.holdState)).toEqual(["committed"]);
    expect(await counts(product.id)).toEqual({ onHand: 7, reserved: 0 });
    expect(await reservationStatus(product.id, order.lines[0]!.holdKey)).toBe("committed");
    const types = (await eventsOf(ctx, order.id)).map((e) => e.type);
    expect(types.filter((t) => t === "stock_committed")).toHaveLength(1);

    expect(await rejection(markShipped(ctx, order.id))).toBeInstanceOf(OrderTransitionError);
    expect(await counts(product.id)).toEqual({ onHand: 7, reserved: 0 });
  });

  it("ships an online order from processing", async () => {
    const ctx = newCtx();
    const { order } = await seedDraft(ctx, { method: "online" });
    await confirmOrder(ctx, order.id);
    expect(await rejection(markShipped(ctx, order.id))).toBeInstanceOf(OrderTransitionError);
    await markPaid(order.id);
    await startProcessing(ctx, order.id);
    expect((await markShipped(ctx, order.id)).status).toBe("shipped");
  });

  it("also releases stale releasingLines and clears them", async () => {
    const ctx = newCtx();
    const { order, product } = await seedDraft(ctx, { quantity: 2 });
    // An edit whose release of the replaced lines fails leaves them in releasingLines.
    seam.failRelease = true;
    await updateDraftOrder(ctx, order.id, { lines: [{ productId: product.id, quantity: 3 }] });
    seam.failRelease = false;
    warnings = "expected";
    expect((await rawOrder(order.id)).hasReleasingLines).toBe(true);
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 5 });

    await confirmOrder(ctx, order.id);
    const shipped = await markShipped(ctx, order.id);

    expect(shipped.stockState).toBe("committed");
    expect(shipped.releasingLines).toBeNull();
    expect(shipped.hasReleasingLines).toBe(false);
    expect(await counts(product.id)).toEqual({ onHand: 7, reserved: 0 });
  });

  it("a transient commit failure returns the shipped order and leaves committing for the sweep", async () => {
    const ctx = newCtx();
    const { order, product } = await seedDraft(ctx);
    await confirmOrder(ctx, order.id);
    seam.commitError = () => new InventoryBusyError();
    warnings = "expected";

    const shipped = await markShipped(ctx, order.id);

    expect(shipped.status).toBe("shipped");
    expect(shipped.stockState).toBe("committing");
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 2 });
    expect(warn.mock.calls[0]![1]).toEqual({ orderId: order.id });
  });

  it("a released reservation (corruption) surfaces a ConflictError, logs an error, leaves committing", async () => {
    const ctx = newCtx();
    const { order, product } = await seedDraft(ctx);
    await confirmOrder(ctx, order.id);
    await actualStock.releaseStock(
      ctx.organizationId,
      product.id,
      "default",
      order.lines[0]!.holdKey,
    );

    const err = await rejection(markShipped(ctx, order.id));

    expect(err).toBeInstanceOf(ConflictError);
    expect(err).not.toBeInstanceOf(OrderTransitionError);
    expect(error).toHaveBeenCalled();
    const raw = await rawOrder(order.id);
    expect(raw.status).toBe("shipped");
    expect(raw.stockState).toBe("committing");
  });
});

describe("markDelivered and markReturned", () => {
  it("delivering a COD order collects the cash; returning it does not restock", async () => {
    const ctx = newCtx();
    const { order, product } = await seedDraft(ctx);
    await confirmOrder(ctx, order.id);
    await markShipped(ctx, order.id);

    const delivered = await markDelivered(ctx, order.id);
    expect(delivered.status).toBe("delivered");
    expect(delivered.paymentStatus).toBe("cod_collected");

    const returned = await markReturned(ctx, order.id);
    expect(returned.status).toBe("returned");
    expect(await counts(product.id)).toEqual({ onHand: 8, reserved: 0 });
    const last = (await statusEvents(ctx, order.id)).find((e) => e.to === "returned")!;
    expect(last.detail).toMatch(/inventory adjustment/i);
  });

  it("every mutation wrote exactly one audit row and one status_changed event", async () => {
    const ctx = newCtx();
    const { order } = await seedDraft(ctx);
    await confirmOrder(ctx, order.id);
    await startProcessing(ctx, order.id);
    await markShipped(ctx, order.id);
    await markDelivered(ctx, order.id);
    await markReturned(ctx, order.id);

    expect(await auditActions(ctx, order.id)).toEqual([
      "order.confirm",
      "order.create",
      "order.deliver",
      "order.process",
      "order.return",
      "order.ship",
    ]);
    const transitions = (await statusEvents(ctx, order.id)).map((e) => `${e.from}>${e.to}`).sort();
    expect(transitions).toEqual([
      "confirmed>processing",
      "delivered>returned",
      "draft>confirmed",
      "processing>shipped",
      "shipped>delivered",
    ]);
  });
});

describe("cancelOrder", () => {
  it("releases the held stock: reserved back to 0, stockState released", async () => {
    const ctx = newCtx();
    const { order, product } = await seedDraft(ctx);
    await confirmOrder(ctx, order.id);

    const cancelled = await cancelOrder(ctx, order.id, "Customer changed their mind");

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.stockState).toBe("released");
    expect(cancelled.cancelReason).toBe("Customer changed their mind");
    expect(cancelled.cancelledAt).toEqual(expect.any(String));
    expect(cancelled.holdExpiresAt).toBeNull();
    expect(cancelled.lines.map((l) => l.holdState)).toEqual(["released"]);
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 0 });
    const types = (await eventsOf(ctx, order.id)).map((e) => e.type);
    expect(types.filter((t) => t === "stock_released")).toHaveLength(1);
    expect(await auditActions(ctx, order.id)).toEqual([
      "order.cancel",
      "order.confirm",
      "order.create",
    ]);
  });

  it("releases the keys of lines, pendingLines and releasingLines", async () => {
    const ctx = newCtx();
    const { order, product } = await seedDraft(ctx, { quantity: 1 });
    const extra = (revision: number): OrderLine => ({
      ...order.lines[0]!,
      holdKey: holdKey(order.id, revision, 0),
      holdState: "pending",
    });
    const pending = extra(8);
    const releasing = extra(9);
    for (const l of [pending, releasing]) {
      await actualStock.reserveStock(ctx.organizationId, product.id, "default", 1, l.holdKey);
    }
    await orderDoc(order.id).update({
      pendingLines: [pending],
      releasingLines: [releasing],
      hasReleasingLines: true,
    });
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 3 });

    const cancelled = await cancelOrder(ctx, order.id, "Duplicate order");

    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 0 });
    expect(cancelled.stockState).toBe("released");
    expect(cancelled.pendingLines).toBeNull();
    expect(cancelled.releasingLines).toBeNull();
    expect(cancelled.hasReleasingLines).toBe(false);
  });

  it("a failed release still cancels and leaves stockState releasing for the sweep", async () => {
    const ctx = newCtx();
    const { order, product } = await seedDraft(ctx);
    seam.failRelease = true;
    warnings = "expected";

    const cancelled = await cancelOrder(ctx, order.id, "Out of time");

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.stockState).toBe("releasing");
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 2 });
    expect(warn.mock.calls[0]![1]).toEqual({ orderId: order.id });
  });

  it("cancelling a shipped order throws", async () => {
    const ctx = newCtx();
    const { order } = await seedDraft(ctx);
    await confirmOrder(ctx, order.id);
    await markShipped(ctx, order.id);
    expect(await rejection(cancelOrder(ctx, order.id, "Too late"))).toBeInstanceOf(
      OrderTransitionError,
    );
  });

  it("a paid order can't be cancelled until a manual refund is recorded", async () => {
    const ctx = newCtx();
    const { order, product } = await seedDraft(ctx, { method: "online" });
    await confirmOrder(ctx, order.id);
    await markPaid(order.id);

    expect(await rejection(cancelOrder(ctx, order.id, "Customer cancelled"))).toBeInstanceOf(
      OrderTransitionError,
    );

    const refunded = await recordManualRefund(ctx, order.id, "Refunded by bKash");
    expect(refunded.paymentStatus).toBe("refunded");
    expect(refunded.status).toBe("confirmed");
    expect(refunded.refund).toEqual({
      reason: "Refunded by bKash",
      at: expect.any(String),
      by: ctx.uid,
    });
    const refundEvents = (await eventsOf(ctx, order.id)).filter(
      (e) => e.type === "refund_recorded",
    );
    expect(refundEvents).toHaveLength(1);
    expect(refundEvents[0]).toMatchObject({ from: "paid", to: "refunded" });

    const cancelled = await cancelOrder(ctx, order.id, "Customer cancelled");
    expect(cancelled.status).toBe("cancelled");
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 0 });
    expect(await auditActions(ctx, order.id)).toEqual([
      "order.cancel",
      "order.confirm",
      "order.create",
      "order.refund",
    ]);
  });

  it("a refund needs a paid order", async () => {
    const ctx = newCtx();
    const { order } = await seedDraft(ctx);
    expect(await rejection(recordManualRefund(ctx, order.id, "No"))).toBeInstanceOf(
      OrderTransitionError,
    );
  });

  it("expire: only an order whose hold is past; system actor recorded", async () => {
    const ctx = newCtx();
    const { order, product } = await seedDraft(ctx);

    const notExpired = await rejection(cancelOrder(sweepCtx(ctx), order.id, "expired", "expire"));
    expect(notExpired).toBeInstanceOf(ConflictError);
    expect((notExpired as Error).message).toBe("This order is no longer expired");
    expect((await rawOrder(order.id)).status).toBe("draft");

    await expireHold(order.id);
    const expired = await cancelOrder(sweepCtx(ctx), order.id, "expired", "expire");

    expect(expired.status).toBe("cancelled");
    expect(expired.cancelReason).toBe("expired");
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 0 });
    const events = await statusEvents(ctx, order.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.actor).toEqual({ kind: "system", id: "sweep" });
    expect(await auditActions(ctx, order.id)).toEqual(["order.create", "order.expire"]);
  });

  it("rejects a blank reason", async () => {
    const ctx = newCtx();
    const { order } = await seedDraft(ctx);
    expect(await rejection(cancelOrder(ctx, order.id, " "))).toBeInstanceOf(ValidationError);
  });
});

describe("failure atomicity (audit write fails inside the transaction)", () => {
  it("confirm, ship and cancel persist nothing and touch no stock", async () => {
    const ctx = newCtx();
    const { order, product } = await seedDraft(ctx);

    audit.fail = true;
    await expect(confirmOrder(ctx, order.id)).rejects.toThrow("audit unavailable");
    await expect(cancelOrder(ctx, order.id, "No")).rejects.toThrow("audit unavailable");
    audit.fail = false;
    let raw = await rawOrder(order.id);
    expect(raw.status).toBe("draft");
    expect(raw.stockState).toBe("held");
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 2 });

    await confirmOrder(ctx, order.id);
    audit.fail = true;
    await expect(markShipped(ctx, order.id)).rejects.toThrow("audit unavailable");
    audit.fail = false;
    raw = await rawOrder(order.id);
    expect(raw.status).toBe("confirmed");
    expect(raw.stockState).toBe("held");
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 2 });

    expect(await statusEvents(ctx, order.id)).toHaveLength(1); // the successful confirm only
    expect(await auditActions(ctx, order.id)).toEqual(["order.confirm", "order.create"]);
  });
});
