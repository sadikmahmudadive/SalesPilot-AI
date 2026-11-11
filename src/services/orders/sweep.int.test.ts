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

import { InventoryBusyError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { customerInputSchema } from "@/schemas/customer";
import { shippingAddressSchema, type OrderLine, type PaymentMethod } from "@/schemas/order";
import { productInputSchema, type Product } from "@/schemas/product";
import { createCustomer } from "@/services/crm/customers";
import { adjustStock } from "@/services/inventory/stock";
import { createProduct } from "@/services/products/products";

import { createDraftOrder, type DraftInput } from "./drafts";
import { cancelOrder, confirmOrder, markShipped } from "./lifecycle";
import { holdKey } from "./stock-holds";
import { SWEEP_BUDGET_MS, sweepOrders } from "./sweep";

// Failure seams: a release can fail, a commit can throw a chosen error; the options of every
// stock call are recorded.
const seam = vi.hoisted(() => ({
  failRelease: false,
  commitError: null as null | (() => unknown),
  options: [] as Array<unknown>,
  /** Runs (once) before the next release: a concurrent writer. */
  beforeRelease: null as null | (() => Promise<unknown>),
}));
vi.mock("@/services/inventory/stock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/inventory/stock")>();
  return {
    ...actual,
    releaseStock: async (...args: Parameters<typeof actual.releaseStock>) => {
      seam.options.push(args[4]);
      const hook = seam.beforeRelease;
      seam.beforeRelease = null;
      if (hook) await hook();
      if (seam.failRelease) throw new Error("release unavailable");
      return actual.releaseStock(...args);
    },
    commitStock: async (...args: Parameters<typeof actual.commitStock>) => {
      seam.options.push(args[4]);
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

let phoneCounter = 0;
const phone = () => `01714${String(1000000 + ++phoneCounter).slice(1)}`;

async function seedProduct(ctx: Ctx, stockUnits = 10): Promise<Product> {
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
  const product = await seedProduct(ctx);
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
  return { order, product };
}

/** Stored timestamps are backdated instead of faking `Date` (gRPC deadlines need a real clock). */
const ago = (ms: number) => Timestamp.fromMillis(Date.now() - ms);
const MIN = 60_000;

const orderDoc = (id: string) => db().collection("orders").doc(id);
const rawOrder = async (id: string) => (await orderDoc(id).get()).data()!;
const expireHold = (id: string) => orderDoc(id).update({ holdExpiresAt: ago(MIN) });
const backdate = (id: string, ms = 10 * MIN) => orderDoc(id).update({ updatedAt: ago(ms) });

const invDoc = (productId: string) => db().collection("inventory").doc(`${productId}__default`);
async function counts(productId: string) {
  const d = (await invDoc(productId).get()).data()!;
  return { onHand: d.onHand as number, reserved: d.reserved as number };
}
async function docsOf(collection: string, organizationId: string) {
  return (await db().collection(collection).where("organizationId", "==", organizationId).get())
    .docs;
}

function lineOf(product: Product, key: string, holdState: OrderLine["holdState"]): OrderLine {
  return {
    productId: product.id,
    variantId: "default",
    productName: product.name,
    variantLabel: null,
    sku: null,
    unitPriceMinor: 50000,
    quantity: 1,
    lineTotalMinor: 50000,
    holdKey: key,
    holdState,
  };
}

/** Writes an order document directly (states the services never leave behind on their own). */
async function writeOrder(
  ctx: Ctx,
  fields: (id: string) => Record<string, unknown>,
): Promise<string> {
  const id = db().collection("orders").doc().id;
  await orderDoc(id).set({
    organizationId: ctx.organizationId,
    orderNumber: `SP-${String(900000 + Math.floor(Math.random() * 99999))}`,
    status: "draft",
    source: "staff",
    createdBy: { kind: "user", uid: ctx.uid },
    customerId: "cust-raw",
    customerSnapshot: { name: "Raw", phoneE164: "+8801700000000" },
    shippingAddress: address(),
    lines: [],
    pendingLines: null,
    releasingLines: null,
    hasReleasingLines: false,
    revision: 1,
    subtotalMinor: 50000,
    discountMinor: 0,
    deliveryChargeMinor: 6000,
    totalMinor: 56000,
    currency: "BDT",
    paymentMethod: "cod",
    paymentStatus: "cod_pending",
    holdExpiresAt: ago(MIN),
    stockState: "pending",
    conversationId: null,
    notes: null,
    idempotencyKey: `key-${randomUUID()}`,
    confirmedAt: null,
    cancelledAt: null,
    cancelReason: null,
    refund: null,
    allowUnpaidReason: null,
    stockAlert: null,
    createdAt: ago(20 * MIN),
    updatedAt: ago(20 * MIN),
    ...fields(id),
  });
  return id;
}

/** Every order in the emulator: the sweep is cross-organization, so each test starts clean. */
async function clearOrders() {
  const snap = await db().collection("orders").get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

const none = { expired: 0, released: 0, committed: 0, errors: 0 };

let warn: MockInstance<typeof logger.warn>;
let error: MockInstance<typeof logger.error>;
let warnings: "none" | "expected" = "none";

beforeEach(async () => {
  seam.failRelease = false;
  seam.commitError = null;
  seam.options = [];
  warnings = "none";
  warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
  error = vi.spyOn(logger, "error").mockImplementation(() => {});
  await clearOrders();
});

afterEach(() => {
  // Restore first: a failing check must not leave the spies (and their calls) to the next test.
  const warned = warn.mock.calls.length;
  warn.mockRestore();
  error.mockRestore();
  if (warnings === "none") expect(warned).toBe(0);
  if (warnings === "expected") expect(warned).toBeGreaterThan(0);
});

afterAll(async () => {
  await clearOrders();
  for (const org of orgs) {
    for (const d of await docsOf("inventory", org)) await db().recursiveDelete(d.ref);
    for (const col of [
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

describe("pass 1: expired holds", () => {
  it("sweep cancels a draft whose lines are still pending (keys never reserved)", async () => {
    const ctx = newCtx();
    const product = await seedProduct(ctx);
    const id = await writeOrder(ctx, (oid) => ({
      lines: [lineOf(product, holdKey(oid, 1, 0), "pending")],
      stockState: "pending",
    }));

    expect(await sweepOrders()).toEqual({ ...none, expired: 1 });

    const raw = await rawOrder(id);
    expect(raw.status).toBe("cancelled");
    expect(raw.cancelReason).toBe("expired");
    expect(raw.stockState).toBe("released");
    expect(raw.lines[0].holdState).toBe("released");
    expect(raw.holdExpiresAt).toBeNull();
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 0 });
    const events = (await docsOf("orderEvents", ctx.organizationId)).map((d) => d.data());
    expect(events.find((e) => e.type === "status_changed")?.actor).toEqual({
      kind: "system",
      id: "sweep",
    });
    expect(events.some((e) => e.type === "stock_released")).toBe(true);
    const audits = (await docsOf("auditLogs", ctx.organizationId)).map((d) => d.data());
    expect(audits.find((a) => a.resourceId === id)).toMatchObject({
      action: "order.expire",
      actorUid: "system:sweep",
    });
  });

  it("expires held drafts and online confirmed orders whose hold is past; leaves the rest", async () => {
    const ctx = newCtx();
    const expiredDraft = await seedDraft(ctx);
    await expireHold(expiredDraft.order.id);
    const liveDraft = await seedDraft(ctx);
    const cod = await seedDraft(ctx);
    await confirmOrder(ctx, cod.order.id); // holdExpiresAt null
    const online = await seedDraft(ctx, { method: "online" });
    await confirmOrder(ctx, online.order.id);
    await expireHold(online.order.id);
    const paid = await seedDraft(ctx, { method: "online" });
    await confirmOrder(ctx, paid.order.id);
    await orderDoc(paid.order.id).update({ paymentStatus: "paid", holdExpiresAt: ago(MIN) });

    expect(await sweepOrders()).toEqual({ ...none, expired: 2 });

    const expired = await rawOrder(expiredDraft.order.id);
    expect(expired).toMatchObject({ status: "cancelled", stockState: "released" });
    expect(await counts(expiredDraft.product.id)).toEqual({ onHand: 10, reserved: 0 });
    expect((await rawOrder(online.order.id)).status).toBe("cancelled");
    expect(await counts(online.product.id)).toEqual({ onHand: 10, reserved: 0 });

    expect((await rawOrder(liveDraft.order.id)).status).toBe("draft");
    expect(await counts(liveDraft.product.id)).toEqual({ onHand: 10, reserved: 2 });
    expect((await rawOrder(cod.order.id)).status).toBe("confirmed");
    expect(await counts(cod.product.id)).toEqual({ onHand: 10, reserved: 2 });
    expect((await rawOrder(paid.order.id)).status).toBe("confirmed");
    expect(await counts(paid.product.id)).toEqual({ onHand: 10, reserved: 2 });
  });

  it("skips an order whose hold was extended after the query (no longer expired), no error", async () => {
    const ctx = newCtx();
    const { order, product } = await seedDraft(ctx);
    // A sweep clock ahead of the server sees the hold as past; the transaction (real clock)
    // finds it still running, exactly like an edit extending the hold after the query.
    const ahead = new Date(Date.now() + 60 * MIN);

    expect(await sweepOrders(ahead)).toEqual(none);

    expect((await rawOrder(order.id)).status).toBe("draft");
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 2 });
  });

  it("pages past a full batch", async () => {
    const ctx = newCtx();
    const a = await seedDraft(ctx);
    const b = await seedDraft(ctx);
    await expireHold(a.order.id);
    await expireHold(b.order.id);

    expect(await sweepOrders(undefined, { batch: 1 })).toEqual({ ...none, expired: 2 });
    expect((await rawOrder(a.order.id)).status).toBe("cancelled");
    expect((await rawOrder(b.order.id)).status).toBe("cancelled");
  });

  it("one corrupt order (missing lines) counts in errors and does not stop the others", async () => {
    const ctx = newCtx();
    const corruptId = await writeOrder(ctx, () => ({ lines: null, stockState: "held" }));
    const { order, product } = await seedDraft(ctx);
    await expireHold(order.id);
    warnings = "expected";

    expect(await sweepOrders()).toEqual({ ...none, expired: 1, errors: 1 });

    expect((await rawOrder(order.id)).status).toBe("cancelled");
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 0 });
    expect(warn).toHaveBeenCalledWith(expect.any(String), { orderId: corruptId });
  });

  it("uses { maxAttempts: 3 } on every stock call", async () => {
    const ctx = newCtx();
    const { order } = await seedDraft(ctx);
    await expireHold(order.id);
    seam.options = [];

    await sweepOrders();

    expect(seam.options.length).toBeGreaterThan(0);
    for (const o of seam.options) expect(o).toEqual({ maxAttempts: 3 });
  });
});

describe("pass 2: stuck releasing", () => {
  it("releases an order stuck in releasing for over 5 minutes; a younger one is untouched", async () => {
    const ctx = newCtx();
    const old = await seedDraft(ctx);
    const young = await seedDraft(ctx);
    seam.failRelease = true;
    await cancelOrder(ctx, old.order.id, "Out of time");
    await cancelOrder(ctx, young.order.id, "Out of time");
    seam.failRelease = false;
    warnings = "expected";
    await backdate(old.order.id, 6 * MIN);
    await backdate(young.order.id, 2 * MIN);
    seam.options = [];

    expect(await sweepOrders()).toEqual({ ...none, released: 1 });

    const raw = await rawOrder(old.order.id);
    expect(raw.stockState).toBe("released");
    expect(raw.lines[0].holdState).toBe("released");
    expect(raw.releasingLines).toBeNull();
    expect(raw.hasReleasingLines).toBe(false);
    expect(await counts(old.product.id)).toEqual({ onHand: 10, reserved: 0 });
    for (const o of seam.options) expect(o).toEqual({ maxAttempts: 3 });

    expect((await rawOrder(young.order.id)).stockState).toBe("releasing");
    expect(await counts(young.product.id)).toEqual({ onHand: 10, reserved: 2 });
  });

  it("also releases the pendingLines and releasingLines of a stuck releasing order", async () => {
    const ctx = newCtx();
    const product = await seedProduct(ctx);
    const id = await writeOrder(ctx, (oid) => {
      const keys = [holdKey(oid, 1, 0), holdKey(oid, 2, 0), holdKey(oid, 3, 0)];
      return {
        status: "cancelled",
        holdExpiresAt: null,
        stockState: "releasing",
        lines: [lineOf(product, keys[0]!, "held")],
        pendingLines: [lineOf(product, keys[1]!, "pending")],
        releasingLines: [lineOf(product, keys[2]!, "held")],
        hasReleasingLines: true,
      };
    });
    const raw0 = await rawOrder(id);
    for (const l of [...raw0.lines, ...raw0.pendingLines, ...raw0.releasingLines]) {
      await actualStock.reserveStock(ctx.organizationId, product.id, "default", 1, l.holdKey);
    }
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 3 });

    // Pass 2 finishes it; pass 5 then finds nothing left.
    expect(await sweepOrders()).toEqual({ ...none, released: 1 });

    const raw = await rawOrder(id);
    expect(raw).toMatchObject({
      stockState: "released",
      pendingLines: null,
      releasingLines: null,
      hasReleasingLines: false,
    });
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 0 });
  });

  it("a release that fails again counts as an error and leaves releasing", async () => {
    const ctx = newCtx();
    const { order, product } = await seedDraft(ctx);
    seam.failRelease = true;
    warnings = "expected";
    await cancelOrder(ctx, order.id, "Out of time");
    await backdate(order.id);

    expect(await sweepOrders()).toEqual({ ...none, errors: 1 });

    expect((await rawOrder(order.id)).stockState).toBe("releasing");
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 2 });
  });
});

describe("pass 3: stuck committing", () => {
  async function stuckCommitting(ctx: Ctx) {
    const seeded = await seedDraft(ctx);
    await confirmOrder(ctx, seeded.order.id);
    seam.commitError = () => new InventoryBusyError();
    await markShipped(ctx, seeded.order.id);
    seam.commitError = null;
    expect((await rawOrder(seeded.order.id)).stockState).toBe("committing");
    await backdate(seeded.order.id);
    return seeded;
  }

  it("commits an order stuck in committing for over 5 minutes", async () => {
    const ctx = newCtx();
    warnings = "expected";
    const { order, product } = await stuckCommitting(ctx);

    expect(await sweepOrders()).toEqual({ ...none, committed: 1 });

    const raw = await rawOrder(order.id);
    expect(raw.stockState).toBe("committed");
    expect(raw.lines[0].holdState).toBe("committed");
    expect(raw.stockAlert).toBeNull();
    expect(await counts(product.id)).toEqual({ onHand: 8, reserved: 0 });
  });

  it("a terminal commit failure sets stockAlert, logs an error, counts once, then is skipped", async () => {
    const ctx = newCtx();
    warnings = "expected";
    const { order, product } = await stuckCommitting(ctx);
    // Corruption: the reservation was released behind the order's back.
    await actualStock.releaseStock(
      ctx.organizationId,
      product.id,
      "default",
      order.lines[0]!.holdKey,
    );

    expect(await sweepOrders()).toEqual({ ...none, errors: 1 });

    const raw = await rawOrder(order.id);
    expect(raw.stockAlert).toBe("commit_failed");
    expect(raw.stockState).toBe("committing");
    expect(error).toHaveBeenCalledWith(expect.any(String), { orderId: order.id });

    await backdate(order.id);
    error.mockClear();
    expect(await sweepOrders()).toEqual(none);
    expect(error).not.toHaveBeenCalled();
  });

  it("a transient commit failure counts as an error and is retried next run", async () => {
    const ctx = newCtx();
    warnings = "expected";
    const { order } = await stuckCommitting(ctx);
    seam.commitError = () => new InventoryBusyError();

    expect(await sweepOrders()).toEqual({ ...none, errors: 1 });
    const raw = await rawOrder(order.id);
    expect(raw.stockState).toBe("committing");
    expect(raw.stockAlert).toBeNull();
  });
});

describe("pass 4: cancelled orders still pending", () => {
  it("releases a cancelled order whose stock is still pending", async () => {
    const ctx = newCtx();
    const product = await seedProduct(ctx);
    const id = await writeOrder(ctx, (oid) => ({
      status: "cancelled",
      holdExpiresAt: null,
      stockState: "pending",
      lines: [lineOf(product, holdKey(oid, 1, 0), "pending")],
    }));
    const key = (await rawOrder(id)).lines[0].holdKey as string;
    await actualStock.reserveStock(ctx.organizationId, product.id, "default", 1, key);

    expect(await sweepOrders()).toEqual({ ...none, released: 1 });

    const raw = await rawOrder(id);
    expect(raw.stockState).toBe("released");
    expect(raw.lines[0].holdState).toBe("released");
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 0 });
  });

  it("leaves a stale pending draft whose hold has not expired alone", async () => {
    const ctx = newCtx();
    const product = await seedProduct(ctx);
    const id = await writeOrder(ctx, (oid) => ({
      holdExpiresAt: Timestamp.fromMillis(Date.now() + 20 * MIN),
      stockState: "pending",
      lines: [lineOf(product, holdKey(oid, 1, 0), "pending")],
    }));

    expect(await sweepOrders()).toEqual(none);
    expect(await rawOrder(id)).toMatchObject({ status: "draft", stockState: "pending" });
  });
});

describe("pass 5: parked releasingLines", () => {
  it("releases releasingLines untouched for over 5 minutes and clears them; a younger set stays", async () => {
    const ctx = newCtx();
    const old = await seedDraft(ctx, { quantity: 1 });
    const young = await seedDraft(ctx, { quantity: 1 });
    const park = async (seeded: typeof old, ms: number) => {
      const parked = lineOf(seeded.product, holdKey(seeded.order.id, 9, 0), "held");
      await actualStock.reserveStock(
        ctx.organizationId,
        seeded.product.id,
        "default",
        1,
        parked.holdKey,
      );
      await orderDoc(seeded.order.id).update({
        releasingLines: [parked],
        hasReleasingLines: true,
        updatedAt: ago(ms),
      });
    };
    await park(old, 6 * MIN);
    await park(young, 2 * MIN);
    expect(await counts(old.product.id)).toEqual({ onHand: 10, reserved: 2 });

    expect(await sweepOrders()).toEqual({ ...none, released: 1 });

    const raw = await rawOrder(old.order.id);
    expect(raw).toMatchObject({
      status: "draft",
      stockState: "held",
      releasingLines: null,
      hasReleasingLines: false,
    });
    expect(raw.lines[0].holdState).toBe("held");
    expect(await counts(old.product.id)).toEqual({ onHand: 10, reserved: 1 });

    expect((await rawOrder(young.order.id)).hasReleasingLines).toBe(true);
    expect(await counts(young.product.id)).toEqual({ onHand: 10, reserved: 2 });
  });

  it("keeps lines parked while the release ran; clears only the released keys", async () => {
    const ctx = newCtx();
    const { order, product } = await seedDraft(ctx, { quantity: 1 });
    const first = lineOf(product, holdKey(order.id, 8, 0), "held");
    const late = lineOf(product, holdKey(order.id, 9, 0), "held");
    for (const l of [first, late]) {
      await actualStock.reserveStock(ctx.organizationId, product.id, "default", 1, l.holdKey);
    }
    await orderDoc(order.id).update({
      releasingLines: [first],
      hasReleasingLines: true,
      updatedAt: ago(10 * MIN),
    });
    // Another writer parks `late` while the sweep releases `first`.
    seam.beforeRelease = () => orderDoc(order.id).update({ releasingLines: [first, late] });

    expect(await sweepOrders()).toEqual({ ...none, released: 1 });

    const raw = await rawOrder(order.id);
    expect(raw.releasingLines.map((l: OrderLine) => l.holdKey)).toEqual([late.holdKey]);
    expect(raw.hasReleasingLines).toBe(true);
    expect(await counts(product.id)).toEqual({ onHand: 10, reserved: 2 });
  });
});

describe("bounded runtime", () => {
  it("starts no order once the budget is spent", async () => {
    expect(SWEEP_BUDGET_MS).toBe(45_000);
    const ctx = newCtx();
    const { order } = await seedDraft(ctx);
    await expireHold(order.id);

    expect(await sweepOrders(undefined, { budgetMs: 0 })).toEqual(none);
    expect((await rawOrder(order.id)).status).toBe("draft");
  });
});
