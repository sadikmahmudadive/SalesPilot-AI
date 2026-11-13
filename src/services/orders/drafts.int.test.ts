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

import { ConflictError, InventoryBusyError, NotFoundError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { idempotencyRef } from "@/repositories/orders";
import { customerInputSchema } from "@/schemas/customer";
import {
  ORDER_ATTEMPT_ENDED_MESSAGE,
  shippingAddressSchema,
  type Order,
  type OrderLineInput,
} from "@/schemas/order";
import { productInputSchema, type Product } from "@/schemas/product";
import { createCustomer } from "@/services/crm/customers";
import { adjustStock } from "@/services/inventory/stock";
import { archiveProduct, createProduct } from "@/services/products/products";

import { STALE_EDIT_MS, createDraftOrder, updateDraftOrder, type DraftInput } from "./drafts";
import { confirmOrder } from "./lifecycle";
import { OrderExpiredError, OrderTransitionError } from "./state-machine";
import { OrderLineError, holdKey, releaseLines } from "./stock-holds";

// Failure seams on the stock service: run a hook before a reserve (to change stock between the
// availability check and the reservation) and make a release throw (to prove compensation
// still cancels the draft and leaves it for the sweep).
const seam = vi.hoisted(() => ({
  beforeReserve: null as null | ((key: string) => Promise<void>),
  failRelease: false,
}));
vi.mock("@/services/inventory/stock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/inventory/stock")>();
  return {
    ...actual,
    reserveStock: async (...args: Parameters<typeof actual.reserveStock>) => {
      if (seam.beforeReserve) await seam.beforeReserve(args[4]);
      return actual.reserveStock(...args);
    },
    releaseStock: async (...args: Parameters<typeof actual.releaseStock>) => {
      if (seam.failRelease) throw new Error("release unavailable");
      return actual.releaseStock(...args);
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
const phone = () => `01712${String(1000000 + ++phoneCounter).slice(1)}`;

async function seedCustomer(ctx: Ctx) {
  return createCustomer(ctx, customerInputSchema.parse({ fullName: "Md. Rahim", phone: phone() }));
}

async function seedProduct(
  ctx: Ctx,
  opts: {
    stock?: number;
    regularPriceMinor?: number;
    salePriceMinor?: number;
    variants?: Array<{ size?: string; color?: string; sku?: string }>;
    variantStock?: number[];
  } = {},
): Promise<Product> {
  const product = await createProduct(
    ctx,
    productInputSchema.parse({
      name: `Shirt ${randomUUID().slice(0, 6)}`,
      sku: `sku-${randomUUID().slice(0, 8)}`,
      regularPriceMinor: opts.regularPriceMinor ?? 50000,
      ...(opts.salePriceMinor !== undefined ? { salePriceMinor: opts.salePriceMinor } : {}),
      availability: "active",
      variants: opts.variants ?? [],
    }),
  );
  if (product.variants.length === 0) {
    if (opts.stock) await stock(ctx, product.id, "default", opts.stock);
  } else {
    for (const [i, v] of product.variants.entries()) {
      const n = opts.variantStock?.[i] ?? 0;
      if (n > 0) await stock(ctx, product.id, v.id, n);
    }
  }
  return product;
}

const stock = (ctx: Ctx, productId: string, variantId: string, delta: number) =>
  adjustStock(ctx, productId, variantId, { delta, reason: "seed" });

const address = () =>
  shippingAddressSchema.parse({
    recipientName: "Rahim",
    phone: "01712345678",
    line1: "House 1, Road 2",
    zone: "inside_dhaka",
  });

function draftInput(customerId: string, lines: OrderLineInput[], over: Partial<DraftInput> = {}) {
  return {
    customerId,
    lines,
    shippingAddress: address(),
    paymentMethod: "cod",
    discountMinor: 0,
    idempotencyKey: `key-${randomUUID()}`,
    source: "staff",
    ...over,
  } satisfies DraftInput;
}

const invDoc = (productId: string, variantId = "default") =>
  db().collection("inventory").doc(`${productId}__${variantId}`);
async function counts(productId: string, variantId = "default") {
  const d = (await invDoc(productId, variantId).get()).data()!;
  return { onHand: d.onHand as number, reserved: d.reserved as number };
}
async function reservation(productId: string, variantId: string, key: string) {
  return (await invDoc(productId, variantId).collection("reservations").doc(key).get()).data();
}
async function docsOf(collection: string, organizationId: string) {
  return (await db().collection(collection).where("organizationId", "==", organizationId).get())
    .docs;
}
const rawOrder = async (id: string) => (await db().collection("orders").doc(id).get()).data()!;

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error("expected a rejection");
    },
    (err: unknown) => err,
  );
}

// Every logger.warn is captured (no log noise). A test that expects warnings sets `warnings`
// to "expected" (asserted) or "allowed" (e.g. contention warnings in the race test); otherwise
// none may be logged.
let warn: MockInstance<typeof logger.warn>;
let warnings: "none" | "expected" | "allowed" = "none";

beforeEach(() => {
  seam.beforeReserve = null;
  seam.failRelease = false;
  warnings = "none";
  warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
});

afterEach(() => {
  if (warnings === "none") expect(warn).not.toHaveBeenCalled();
  if (warnings === "expected") expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

/**
 * A stored `updatedAt` `ms` in the past. Staleness is pinned by backdating the stored time, not
 * by faking `Date`: jumping the process clock minutes ahead makes the Firestore gRPC client fail
 * its own deadlines ("DEADLINE_EXCEEDED ... Waiting for LB pick").
 */
const updatedAgo = (ms: number) => Timestamp.fromMillis(Date.now() - ms);

/** The id inside a hold key `ord_{orderId}_r{revision}_l{index}`. */
const orderIdOfKey = (key: string) => /^ord_(.+)_r\d+_l\d+$/.exec(key)?.[1];

/** What the expiry sweep does to a draft it cancels (status only; its release is not run). */
const sweepCancel = (orderId: string) =>
  db().collection("orders").doc(orderId).update({
    status: "cancelled",
    cancelReason: "expired",
    stockState: "released",
    holdExpiresAt: null,
  });

afterAll(async () => {
  for (const org of orgs) {
    for (const col of ["inventory"]) {
      for (const d of await docsOf(col, org)) await db().recursiveDelete(d.ref);
    }
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

describe("createDraftOrder", () => {
  it("creates SP-000001 with every line held, one created event and one audit row", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const plain = await seedProduct(ctx, { stock: 10, regularPriceMinor: 50000 });
    const varied = await seedProduct(ctx, {
      regularPriceMinor: 90000,
      salePriceMinor: 80000,
      variants: [
        { size: "S", color: "Red" },
        { size: "M", sku: "SHIRT-M" },
      ],
      variantStock: [4, 4],
    });
    const m = varied.variants[1]!;
    const s = varied.variants[0]!;

    const before = Date.now();
    const order = await createDraftOrder(
      ctx,
      draftInput(customer.id, [
        { productId: plain.id, quantity: 2 },
        { productId: varied.id, variantId: m.id, quantity: 1 },
        { productId: varied.id, variantId: s.id, quantity: 3 },
      ]),
    );

    expect(order).toMatchObject({
      organizationId: ctx.organizationId,
      orderNumber: "SP-000001",
      status: "draft",
      paymentStatus: "cod_pending",
      paymentMethod: "cod",
      source: "staff",
      createdBy: { kind: "user", uid: ctx.uid },
      customerId: customer.id,
      customerSnapshot: { name: "Md. Rahim", phoneE164: customer.phoneE164 },
      revision: 1,
      stockState: "held",
      pendingLines: null,
      releasingLines: null,
      hasReleasingLines: false,
      subtotalMinor: 2 * 50000 + 80000 + 3 * 80000,
      discountMinor: 0,
      deliveryChargeMinor: 6000,
      totalMinor: 2 * 50000 + 80000 + 3 * 80000 + 6000,
      currency: "BDT",
      cancelReason: null,
    });
    expect(order.lines).toEqual([
      {
        productId: plain.id,
        variantId: "default",
        productName: plain.name,
        variantLabel: null,
        sku: plain.sku,
        unitPriceMinor: 50000,
        quantity: 2,
        lineTotalMinor: 100000,
        holdKey: holdKey(order.id, 1, 0),
        holdState: "held",
      },
      {
        productId: varied.id,
        variantId: m.id,
        productName: varied.name,
        variantLabel: "M",
        sku: "SHIRT-M",
        unitPriceMinor: 80000,
        quantity: 1,
        lineTotalMinor: 80000,
        holdKey: holdKey(order.id, 1, 1),
        holdState: "held",
      },
      {
        productId: varied.id,
        variantId: s.id,
        productName: varied.name,
        variantLabel: "S / Red",
        sku: varied.sku,
        unitPriceMinor: 80000,
        quantity: 3,
        lineTotalMinor: 240000,
        holdKey: holdKey(order.id, 1, 2),
        holdState: "held",
      },
    ]);
    expect(holdKey(order.id, 1, 2)).toBe(`ord_${order.id}_r1_l2`);

    const hold = Date.parse(order.holdExpiresAt!);
    expect(hold).toBeGreaterThanOrEqual(before + 30 * 60_000 - 1000);
    expect(hold).toBeLessThanOrEqual(Date.now() + 30 * 60_000 + 1000);
    expect((await rawOrder(order.id)).holdExpiresAt).toBeInstanceOf(Timestamp);

    expect(await counts(plain.id)).toEqual({ onHand: 10, reserved: 2 });
    expect(await counts(varied.id, m.id)).toEqual({ onHand: 4, reserved: 1 });
    expect(await counts(varied.id, s.id)).toEqual({ onHand: 4, reserved: 3 });
    expect(await reservation(plain.id, "default", holdKey(order.id, 1, 0))).toMatchObject({
      status: "reserved",
      quantity: 2,
    });

    const events = await docsOf("orderEvents", ctx.organizationId);
    expect(events).toHaveLength(1);
    expect(events[0]!.data()).toMatchObject({
      orderId: order.id,
      type: "created",
      to: "draft",
      actor: { kind: "user", id: ctx.uid },
    });

    const audits = (await docsOf("auditLogs", ctx.organizationId))
      .map((d) => d.data())
      .filter((a) => a.action.startsWith("order."));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "order.create",
      resource: "order",
      resourceId: order.id,
      actorUid: ctx.uid,
    });

    const numberLock = await db()
      .collection("orderNumbers")
      .doc(`${ctx.organizationId}_SP-000001`)
      .get();
    expect(numberLock.data()).toMatchObject({ orderId: order.id });
  });

  it("records an AI creator and actor", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const p = await seedProduct(ctx, { stock: 2 });
    const order = await createDraftOrder(
      { ...ctx, actor: { kind: "ai", agentId: "agent-1", sessionId: "sess-1" } },
      draftInput(customer.id, [{ productId: p.id, quantity: 1 }], {
        source: "ai",
        conversationId: "conv-1",
        paymentMethod: "online",
      }),
    );
    expect(order).toMatchObject({
      source: "ai",
      createdBy: { kind: "ai", agentId: "agent-1", sessionId: "sess-1" },
      conversationId: "conv-1",
      paymentStatus: "awaiting_payment",
    });
    const events = await docsOf("orderEvents", ctx.organizationId);
    expect(events[0]!.data().actor).toEqual({ kind: "ai", id: "agent-1" });
  });

  it("same idempotency key returns the same order", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const p = await seedProduct(ctx, { stock: 5 });
    const input = draftInput(customer.id, [{ productId: p.id, quantity: 2 }]);

    const first = await createDraftOrder(ctx, input);
    const second = await createDraftOrder(ctx, input);

    expect(second.id).toBe(first.id);
    expect(second.orderNumber).toBe("SP-000001");
    expect(await counts(p.id)).toEqual({ onHand: 5, reserved: 2 });
    expect(await docsOf("orders", ctx.organizationId)).toHaveLength(1);
    expect(await docsOf("orderEvents", ctx.organizationId)).toHaveLength(1);
  });

  it("rejects split lines that together exceed stock", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const p = await seedProduct(ctx, { stock: 3 });

    const err = await rejection(
      createDraftOrder(
        ctx,
        draftInput(customer.id, [
          { productId: p.id, quantity: 2 },
          { productId: p.id, quantity: 2 },
        ]),
      ),
    );

    expect(err).toBeInstanceOf(OrderLineError);
    expect((err as OrderLineError).details).toEqual([{ path: "lines.1", message: "out_of_stock" }]);
    expect(await counts(p.id)).toEqual({ onHand: 3, reserved: 0 });
    expect(await docsOf("orders", ctx.organizationId)).toHaveLength(0);
    expect(await docsOf("orderCounters", ctx.organizationId)).toHaveLength(0);
    expect(await docsOf("orderIdempotency", ctx.organizationId)).toHaveLength(0);
    expect(await docsOf("orderEvents", ctx.organizationId)).toHaveLength(0);
  });

  it("lists every failing line: archived is unavailable, a missing or unknown variant is invalid_variant", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const archived = await seedProduct(ctx, { stock: 5 });
    await archiveProduct(ctx, archived.id);
    const varied = await seedProduct(ctx, { variants: [{ size: "S" }], variantStock: [5] });
    const ok = await seedProduct(ctx, { stock: 5 });

    const err = await rejection(
      createDraftOrder(
        ctx,
        draftInput(customer.id, [
          { productId: archived.id, quantity: 1 },
          { productId: varied.id, quantity: 1 },
          { productId: ok.id, quantity: 1 },
          { productId: varied.id, variantId: "nope", quantity: 1 },
          { productId: `missing-${randomUUID()}`, quantity: 1 },
        ]),
      ),
    );

    expect(err).toBeInstanceOf(OrderLineError);
    expect((err as OrderLineError).details).toEqual([
      { path: "lines.0", message: "unavailable" },
      { path: "lines.1", message: "invalid_variant" },
      { path: "lines.3", message: "invalid_variant" },
      { path: "lines.4", message: "unavailable" },
    ]);
    expect(await counts(ok.id)).toEqual({ onHand: 5, reserved: 0 });
    expect(await docsOf("orders", ctx.organizationId)).toHaveLength(0);
  });

  it("another org's customer id is NotFound and writes nothing", async () => {
    const ctx = newCtx();
    const other = newCtx();
    const foreign = await seedCustomer(other);
    const p = await seedProduct(ctx, { stock: 5 });

    await expect(
      createDraftOrder(ctx, draftInput(foreign.id, [{ productId: p.id, quantity: 1 }])),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createDraftOrder(ctx, draftInput("bad/id", [{ productId: p.id, quantity: 1 }])),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await docsOf("orders", ctx.organizationId)).toHaveLength(0);
    expect(await counts(p.id)).toEqual({ onHand: 5, reserved: 0 });
  });

  it("race: ten concurrent drafts of 1 against stock 5 hold exactly 5", async () => {
    warnings = "allowed"; // contention can log "inventory transaction gave up"
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const p = await seedProduct(ctx, { stock: 5 });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        createDraftOrder(ctx, draftInput(customer.id, [{ productId: p.id, quantity: 1 }])),
      ),
    );

    for (const r of results) {
      if (r.status === "rejected") {
        expect(r.reason instanceof OrderLineError || r.reason instanceof InventoryBusyError).toBe(
          true,
        );
      }
    }
    const stored = (await docsOf("orders", ctx.organizationId)).map((d) => d.data());
    const held = stored.filter((o) => o.stockState === "held");
    expect(held).toHaveLength(5);
    for (const o of held) expect(o.status).toBe("draft");
    for (const o of stored.filter((x) => x.stockState !== "held")) {
      expect(o).toMatchObject({
        status: "cancelled",
        cancelReason: "stock_unavailable",
        stockState: "released",
        holdExpiresAt: null,
      });
    }
    expect(await counts(p.id)).toEqual({ onHand: 5, reserved: 5 });
  });

  it("a reserve that fails after the check releases earlier lines and cancels the draft", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    const b = await seedProduct(ctx, { stock: 2 });
    // Someone else takes product b's stock between the check and line 1's reserve.
    seam.beforeReserve = async (key) => {
      if (key.endsWith("_l1")) {
        seam.beforeReserve = null;
        await actualStock.reserveStock(ctx.organizationId, b.id, "default", 2, "other-order");
      }
    };

    const err = await rejection(
      createDraftOrder(
        ctx,
        draftInput(customer.id, [
          { productId: a.id, quantity: 3 },
          { productId: b.id, quantity: 1 },
        ]),
      ),
    );

    expect(err).toBeInstanceOf(OrderLineError);
    expect((err as OrderLineError).details).toEqual([{ path: "lines.1", message: "out_of_stock" }]);
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 0 });
    expect(await counts(b.id)).toEqual({ onHand: 2, reserved: 2 });

    const [order] = (await docsOf("orders", ctx.organizationId)).map((d) => ({
      id: d.id,
      ...d.data(),
    })) as Array<Record<string, unknown> & { id: string; lines: Array<{ holdState: string }> }>;
    expect(order).toMatchObject({
      status: "cancelled",
      cancelReason: "stock_unavailable",
      stockState: "released",
      holdExpiresAt: null,
    });
    expect(order!.lines.map((l) => l.holdState)).toEqual(["released", "released"]);
    expect(await reservation(a.id, "default", holdKey(order!.id, 1, 0))).toMatchObject({
      status: "released",
    });
    // Transaction C cancels first; the release is then finished as the sweep would (R20).
    const types = (await docsOf("orderEvents", ctx.organizationId)).map((d) => d.data().type);
    expect(types.sort()).toEqual(["created", "status_changed", "stock_released"]);
  });

  it("a release failure during compensation still cancels, leaves stockState releasing and rethrows the original error", async () => {
    warnings = "expected";
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    const b = await seedProduct(ctx, { stock: 1 });
    seam.beforeReserve = async (key) => {
      if (key.endsWith("_l1")) {
        seam.beforeReserve = null;
        seam.failRelease = true;
        await actualStock.reserveStock(ctx.organizationId, b.id, "default", 1, "other-order");
      }
    };

    const err = await rejection(
      createDraftOrder(
        ctx,
        draftInput(customer.id, [
          { productId: a.id, quantity: 1 },
          { productId: b.id, quantity: 1 },
        ]),
      ),
    );

    expect(err).toBeInstanceOf(OrderLineError);
    const [order] = (await docsOf("orders", ctx.organizationId)).map((d) => d.data());
    expect(order).toMatchObject({
      status: "cancelled",
      cancelReason: "stock_unavailable",
      stockState: "releasing",
    });
    // Line 0 is still reserved; the sweep finishes the release from stockState "releasing".
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 1 });
    expect(warn).toHaveBeenCalledWith(expect.any(String), { orderId: expect.any(String) });
  });
});

describe("updateDraftOrder", () => {
  async function draftWith(ctx: Ctx, lines: OrderLineInput[]): Promise<Order> {
    const customer = await seedCustomer(ctx);
    return createDraftOrder(ctx, draftInput(customer.id, lines));
  }

  it("update replaces lines: old released, new reserved, re-priced, revision 2", async () => {
    const ctx = newCtx();
    const a = await seedProduct(ctx, { stock: 5, regularPriceMinor: 10000 });
    const b = await seedProduct(ctx, { stock: 5, regularPriceMinor: 30000 });
    const draft = await draftWith(ctx, [{ productId: a.id, quantity: 2 }]);

    const updated = await updateDraftOrder(ctx, draft.id, {
      lines: [{ productId: b.id, quantity: 3 }],
      discountMinor: 5000,
    });

    expect(updated).toMatchObject({
      id: draft.id,
      orderNumber: draft.orderNumber,
      status: "draft",
      revision: 2,
      stockState: "held",
      pendingLines: null,
      releasingLines: null,
      hasReleasingLines: false,
      subtotalMinor: 90000,
      discountMinor: 5000,
      deliveryChargeMinor: 6000,
      totalMinor: 90000 - 5000 + 6000,
    });
    expect(updated.lines).toHaveLength(1);
    expect(updated.lines[0]).toMatchObject({
      productId: b.id,
      quantity: 3,
      unitPriceMinor: 30000,
      lineTotalMinor: 90000,
      holdKey: holdKey(draft.id, 2, 0),
      holdState: "held",
    });
    expect(Date.parse(updated.holdExpiresAt!)).toBeGreaterThanOrEqual(
      Date.parse(draft.holdExpiresAt!),
    );

    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 0 });
    expect(await counts(b.id)).toEqual({ onHand: 5, reserved: 3 });
    expect(await reservation(a.id, "default", holdKey(draft.id, 1, 0))).toMatchObject({
      status: "released",
    });
    expect(await reservation(b.id, "default", holdKey(draft.id, 2, 0))).toMatchObject({
      status: "reserved",
    });

    const events = (await docsOf("orderEvents", ctx.organizationId)).map((d) => d.data().type);
    expect(events.sort()).toEqual(["created", "updated"]);
    const actions = (await docsOf("auditLogs", ctx.organizationId))
      .map((d) => d.data().action as string)
      .filter((a) => a.startsWith("order."));
    expect(actions.sort()).toEqual(["order.create", "order.update"]);
  });

  it("a patch without lines re-prices, keeps the holds and does not extend the hold", async () => {
    const ctx = newCtx();
    const a = await seedProduct(ctx, { stock: 5, regularPriceMinor: 10000 });
    const draft = await draftWith(ctx, [{ productId: a.id, quantity: 2 }]);

    const updated = await updateDraftOrder(ctx, draft.id, {
      shippingAddress: { ...address(), zone: "outside_dhaka" },
      paymentMethod: "online",
      notes: "Call first",
    });

    expect(updated).toMatchObject({
      revision: 1,
      stockState: "held",
      deliveryChargeMinor: 12000,
      totalMinor: 20000 + 12000,
      paymentMethod: "online",
      paymentStatus: "awaiting_payment",
      notes: "Call first",
      lines: draft.lines,
      holdExpiresAt: draft.holdExpiresAt,
    });
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 2 });
  });

  it("a failed reserve keeps the old lines held and clears pendingLines", async () => {
    const ctx = newCtx();
    const a = await seedProduct(ctx, { stock: 5 });
    const b = await seedProduct(ctx, { stock: 1 });
    const draft = await draftWith(ctx, [{ productId: a.id, quantity: 2 }]);

    const err = await rejection(
      updateDraftOrder(ctx, draft.id, { lines: [{ productId: b.id, quantity: 2 }] }),
    );
    expect(err).toBeInstanceOf(OrderLineError);

    seam.beforeReserve = async (key) => {
      if (key.endsWith("_l1")) {
        seam.beforeReserve = null;
        await actualStock.reserveStock(ctx.organizationId, b.id, "default", 1, "other-order");
      }
    };
    const err2 = await rejection(
      updateDraftOrder(ctx, draft.id, {
        lines: [
          { productId: a.id, quantity: 1 },
          { productId: b.id, quantity: 1 },
        ],
      }),
    );
    expect(err2).toBeInstanceOf(OrderLineError);
    expect((err2 as OrderLineError).details).toEqual([
      { path: "lines.1", message: "out_of_stock" },
    ]);

    const stored = await rawOrder(draft.id);
    expect(stored.pendingLines).toBeNull();
    expect(stored.stockState).toBe("held");
    expect(stored.status).toBe("draft");
    expect(stored.lines).toEqual(draft.lines);
    // Old line (2) still held; the new revision's line 0 (1 of a) was released again.
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 2 });
  });

  it("update of an expired draft is OrderExpiredError; of a cancelled order a transition error", async () => {
    const ctx = newCtx();
    const a = await seedProduct(ctx, { stock: 5 });
    const draft = await draftWith(ctx, [{ productId: a.id, quantity: 1 }]);
    await db()
      .collection("orders")
      .doc(draft.id)
      .update({ holdExpiresAt: Timestamp.fromMillis(Date.now() - 1000) });

    await expect(updateDraftOrder(ctx, draft.id, { notes: "x" })).rejects.toBeInstanceOf(
      OrderExpiredError,
    );
    await expect(
      updateDraftOrder(ctx, draft.id, { lines: [{ productId: a.id, quantity: 2 }] }),
    ).rejects.toBeInstanceOf(OrderExpiredError);
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 1 });

    await db().collection("orders").doc(draft.id).update({ status: "cancelled" });
    await expect(updateDraftOrder(ctx, draft.id, { notes: "x" })).rejects.toBeInstanceOf(
      OrderTransitionError,
    );
  });

  it("another org's order is NotFound", async () => {
    const ctx = newCtx();
    const a = await seedProduct(ctx, { stock: 5 });
    const draft = await draftWith(ctx, [{ productId: a.id, quantity: 1 }]);
    const other = newCtx();
    await expect(updateDraftOrder(other, draft.id, { notes: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(updateDraftOrder(ctx, "bad/id", { notes: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

// ---- fix round 1: replays, late reservations, releasingLines, stale pendingLines -----------

function lineOf(product: Product, quantity: number, key: string, holdState = "pending") {
  return {
    productId: product.id,
    variantId: "default",
    productName: product.name,
    variantLabel: null,
    sku: product.sku,
    unitPriceMinor: product.regularPriceMinor,
    quantity,
    lineTotalMinor: product.regularPriceMinor * quantity,
    holdKey: key,
    holdState,
  };
}

/** A draft exactly as Transaction A leaves it (lines pending), as if its creator then crashed. */
async function writePendingDraft(
  ctx: Ctx,
  customerId: string,
  items: Array<{ product: Product; quantity: number }>,
  idempotencyKey: string,
): Promise<string> {
  const orderId = db().collection("orders").doc().id;
  const lines = items.map((it, i) => lineOf(it.product, it.quantity, holdKey(orderId, 1, i)));
  const subtotalMinor = lines.reduce((sum, l) => sum + l.lineTotalMinor, 0);
  await db()
    .collection("orders")
    .doc(orderId)
    .set({
      organizationId: ctx.organizationId,
      orderNumber: "SP-000001",
      status: "draft",
      source: "staff",
      createdBy: { kind: "user", uid: ctx.uid },
      customerId,
      customerSnapshot: { name: "Md. Rahim", phoneE164: "+8801712000000" },
      shippingAddress: address(),
      lines,
      pendingLines: null,
      releasingLines: null,
      hasReleasingLines: false,
      revision: 1,
      subtotalMinor,
      discountMinor: 0,
      deliveryChargeMinor: 6000,
      totalMinor: subtotalMinor + 6000,
      currency: "BDT",
      paymentMethod: "cod",
      paymentStatus: "cod_pending",
      holdExpiresAt: Timestamp.fromMillis(Date.now() + 30 * 60_000),
      stockState: "pending",
      conversationId: null,
      notes: null,
      idempotencyKey,
      confirmedAt: null,
      cancelledAt: null,
      cancelReason: null,
      refund: null,
      allowUnpaidReason: null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  await idempotencyRef(ctx.organizationId, idempotencyKey).set({
    organizationId: ctx.organizationId,
    orderId,
  });
  return orderId;
}

describe("idempotent replay of a pending draft", () => {
  it("resumes reserving the stored lines and returns the held order", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    const b = await seedProduct(ctx, { stock: 5 });
    const key = `key-${randomUUID()}`;
    const orderId = await writePendingDraft(
      ctx,
      customer.id,
      [
        { product: a, quantity: 2 },
        { product: b, quantity: 1 },
      ],
      key,
    );
    // The creator got as far as reserving line 0 before it stopped.
    await actualStock.reserveStock(ctx.organizationId, a.id, "default", 2, holdKey(orderId, 1, 0));

    const order = await createDraftOrder(
      ctx,
      draftInput(
        customer.id,
        [
          { productId: a.id, quantity: 2 },
          { productId: b.id, quantity: 1 },
        ],
        { idempotencyKey: key },
      ),
    );

    expect(order).toMatchObject({ id: orderId, status: "draft", stockState: "held" });
    expect(order.lines.map((l) => l.holdState)).toEqual(["held", "held"]);
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 2 });
    expect(await counts(b.id)).toEqual({ onHand: 5, reserved: 1 });
    expect(await docsOf("orders", ctx.organizationId)).toHaveLength(1);
  });

  it("a resumed replay that cannot reserve is cancelled like a create", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const b = await seedProduct(ctx, { stock: 2 });
    const key = `key-${randomUUID()}`;
    const orderId = await writePendingDraft(ctx, customer.id, [{ product: b, quantity: 3 }], key);

    const err = await rejection(
      createDraftOrder(
        ctx,
        draftInput(customer.id, [{ productId: b.id, quantity: 3 }], { idempotencyKey: key }),
      ),
    );

    expect(err).toBeInstanceOf(OrderLineError);
    expect((err as OrderLineError).details).toEqual([{ path: "lines.0", message: "out_of_stock" }]);
    expect(await rawOrder(orderId)).toMatchObject({
      status: "cancelled",
      cancelReason: "stock_unavailable",
      stockState: "released",
    });
    expect(await counts(b.id)).toEqual({ onHand: 2, reserved: 0 });
  });

  it("when a concurrent replay holds the draft first, the original call returns the held order", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    const input = draftInput(customer.id, [{ productId: a.id, quantity: 2 }]);
    let replayed: Order | null = null;
    seam.beforeReserve = async () => {
      seam.beforeReserve = null;
      replayed = await createDraftOrder(ctx, input); // a double submit, while we are reserving
    };

    const order = await createDraftOrder(ctx, input);

    expect(replayed).not.toBeNull();
    expect(replayed!.id).toBe(order.id);
    expect(replayed!.stockState).toBe("held");
    expect(order).toMatchObject({ stockState: "held", status: "draft" });
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 2 });
  });

  it("when a concurrent replay holds and confirms the draft first, the slow original releases nothing (R20)", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    const input = draftInput(customer.id, [{ productId: a.id, quantity: 2 }]);
    let confirmed: Order | null = null;
    seam.beforeReserve = async () => {
      seam.beforeReserve = null;
      const replayed = await createDraftOrder(ctx, input);
      confirmed = await confirmOrder(ctx, replayed.id);
    };

    const order = await createDraftOrder(ctx, input);

    expect(confirmed!.status).toBe("confirmed");
    expect(order).toMatchObject({ id: confirmed!.id, status: "confirmed", stockState: "held" });
    expect(await rawOrder(order.id)).toMatchObject({ status: "confirmed", stockState: "held" });
    expect(await reservation(a.id, "default", holdKey(order.id, 1, 0))).toMatchObject({
      status: "reserved",
    });
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 2 });
  });

  it("a slow original whose reserve fails after a replay confirmed the order neither cancels it nor releases its holds (R20)", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    const input = draftInput(customer.id, [{ productId: a.id, quantity: 2 }]);
    seam.beforeReserve = async () => {
      seam.beforeReserve = null;
      const replayed = await createDraftOrder(ctx, input);
      await confirmOrder(ctx, replayed.id);
      throw new InventoryBusyError(); // the original's own reserve then loses to contention
    };

    const order = await createDraftOrder(ctx, input);

    expect(order).toMatchObject({ status: "confirmed", stockState: "held" });
    expect(await rawOrder(order.id)).toMatchObject({ status: "confirmed", stockState: "held" });
    expect(await reservation(a.id, "default", holdKey(order.id, 1, 0))).toMatchObject({
      status: "reserved",
    });
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 2 });
  });

  it("a failed edit (revision bumped) before the slow original's Transaction B leaves the live lines reserved (R20)", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    const b = await seedProduct(ctx, { stock: 1 });
    const input = draftInput(customer.id, [{ productId: a.id, quantity: 2 }]);
    seam.beforeReserve = async () => {
      seam.beforeReserve = null;
      const replayed = await createDraftOrder(ctx, input); // holds revision 1
      // An edit whose reserve fails after its Transaction 1 bumped the revision to 2.
      seam.beforeReserve = async () => {
        seam.beforeReserve = null;
        await actualStock.reserveStock(ctx.organizationId, b.id, "default", 1, "other-order");
      };
      await expect(
        updateDraftOrder(ctx, replayed.id, { lines: [{ productId: b.id, quantity: 1 }] }),
      ).rejects.toBeInstanceOf(OrderLineError);
    };

    const order = await createDraftOrder(ctx, input);

    expect(order).toMatchObject({
      status: "draft",
      revision: 2,
      stockState: "held",
      pendingLines: null,
    });
    expect(order.lines.map((l) => l.holdKey)).toEqual([holdKey(order.id, 1, 0)]);
    expect(await reservation(a.id, "default", holdKey(order.id, 1, 0))).toMatchObject({
      status: "reserved",
    });
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 2 });
  });
});

describe("spent idempotency keys (R20)", () => {
  async function expectSpent(p: Promise<unknown>) {
    const err = await rejection(p);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).message).toBe(ORDER_ATTEMPT_ENDED_MESSAGE);
  }

  it("a replay of a key whose draft was cancelled after a failed reserve is a 409 and creates nothing", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 2 });
    const input = draftInput(customer.id, [{ productId: a.id, quantity: 1 }]);
    seam.beforeReserve = async () => {
      seam.beforeReserve = null;
      await actualStock.reserveStock(ctx.organizationId, a.id, "default", 2, "other-order");
    };
    await expect(createDraftOrder(ctx, input)).rejects.toBeInstanceOf(OrderLineError);
    await actualStock.releaseStock(ctx.organizationId, a.id, "default", "other-order");

    await expectSpent(createDraftOrder(ctx, input));

    const orders = (await docsOf("orders", ctx.organizationId)).map((d) => d.data());
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ status: "cancelled", cancelReason: "stock_unavailable" });
    expect(await counts(a.id)).toEqual({ onHand: 2, reserved: 0 });
  });

  it("a replay of an expired draft's key is a 409 and changes nothing", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    const input = draftInput(customer.id, [{ productId: a.id, quantity: 1 }]);
    const draft = await createDraftOrder(ctx, input);
    await db()
      .collection("orders")
      .doc(draft.id)
      .update({ holdExpiresAt: Timestamp.fromMillis(Date.now() - 1000) });

    await expectSpent(createDraftOrder(ctx, input));

    expect(await docsOf("orders", ctx.organizationId)).toHaveLength(1);
    expect(await rawOrder(draft.id)).toMatchObject({ status: "draft", stockState: "held" });
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 1 });
  });
});

describe("late reservations", () => {
  it("the sweep cancelling a draft during its reserves: the stock is given back (B finds it ended)", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    seam.beforeReserve = async (key) => {
      seam.beforeReserve = null;
      await sweepCancel(orderIdOfKey(key)!);
    };

    const err = await rejection(
      createDraftOrder(ctx, draftInput(customer.id, [{ productId: a.id, quantity: 2 }])),
    );

    expect(err).toBeInstanceOf(OrderExpiredError);
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 0 });
    const [order] = (await docsOf("orders", ctx.organizationId)).map((d) => d.data());
    expect(order).toMatchObject({
      status: "cancelled",
      releasingLines: null,
      hasReleasingLines: false,
    });
  });

  it("if giving that stock back fails, the lines are parked in releasingLines of the cancelled order", async () => {
    warnings = "expected";
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    seam.beforeReserve = async (key) => {
      seam.beforeReserve = null;
      await sweepCancel(orderIdOfKey(key)!);
      seam.failRelease = true;
    };

    const err = await rejection(
      createDraftOrder(ctx, draftInput(customer.id, [{ productId: a.id, quantity: 2 }])),
    );

    expect(err).toBeInstanceOf(OrderExpiredError);
    const [doc] = await docsOf("orders", ctx.organizationId);
    const stored = doc!.data();
    expect(stored.status).toBe("cancelled");
    expect(stored.hasReleasingLines).toBe(true);
    expect(stored.releasingLines.map((l: { holdKey: string }) => l.holdKey)).toEqual([
      holdKey(doc!.id, 1, 0),
    ]);
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 2 });

    seam.failRelease = false;
    await releaseLines(ctx.organizationId, stored.releasingLines);
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 0 });
  });

  it("the sweep cancelling a draft during an edit's reserves: the new lines are given back (T2 finds it ended)", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    const b = await seedProduct(ctx, { stock: 5 });
    const draft = await createDraftOrder(
      ctx,
      draftInput(customer.id, [{ productId: a.id, quantity: 1 }]),
    );
    seam.beforeReserve = async () => {
      seam.beforeReserve = null;
      await sweepCancel(draft.id);
    };

    const err = await rejection(
      updateDraftOrder(ctx, draft.id, { lines: [{ productId: b.id, quantity: 2 }] }),
    );

    expect(err).toBeInstanceOf(OrderTransitionError);
    expect(await counts(b.id)).toEqual({ onHand: 5, reserved: 0 });
    expect(await reservation(b.id, "default", holdKey(draft.id, 2, 0))).toMatchObject({
      status: "released",
    });
    expect((await rawOrder(draft.id)).hasReleasingLines).toBe(false);
  });

  it("if giving an edit's new lines back fails, they are parked in releasingLines", async () => {
    warnings = "expected";
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    const b = await seedProduct(ctx, { stock: 5 });
    const draft = await createDraftOrder(
      ctx,
      draftInput(customer.id, [{ productId: a.id, quantity: 1 }]),
    );
    seam.beforeReserve = async () => {
      seam.beforeReserve = null;
      await sweepCancel(draft.id);
      seam.failRelease = true;
    };

    const err = await rejection(
      updateDraftOrder(ctx, draft.id, { lines: [{ productId: b.id, quantity: 2 }] }),
    );

    expect(err).toBeInstanceOf(OrderTransitionError);
    const stored = await rawOrder(draft.id);
    expect(stored.hasReleasingLines).toBe(true);
    expect(stored.releasingLines.map((l: { holdKey: string }) => l.holdKey)).toEqual([
      holdKey(draft.id, 2, 0),
    ]);
    expect(await counts(b.id)).toEqual({ onHand: 5, reserved: 2 });
  });
});

describe("releasingLines and stale pendingLines", () => {
  it("a failed release of the replaced lines keeps them in releasingLines, reserved, until released", async () => {
    warnings = "expected";
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    const b = await seedProduct(ctx, { stock: 5 });
    const draft = await createDraftOrder(
      ctx,
      draftInput(customer.id, [{ productId: a.id, quantity: 2 }]),
    );
    seam.failRelease = true;

    const updated = await updateDraftOrder(ctx, draft.id, {
      lines: [{ productId: b.id, quantity: 1 }],
    });

    expect(updated).toMatchObject({ revision: 2, stockState: "held", hasReleasingLines: true });
    expect(updated.releasingLines).toEqual(draft.lines);
    expect(await reservation(a.id, "default", holdKey(draft.id, 1, 0))).toMatchObject({
      status: "reserved",
    });
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 2 });
    expect(await counts(b.id)).toEqual({ onHand: 5, reserved: 1 });
    expect(warn).toHaveBeenCalledWith(expect.any(String), { orderId: draft.id });

    seam.failRelease = false;
    await releaseLines(ctx.organizationId, updated.releasingLines!);
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 0 });
  });

  async function draftWithStalePending(ctx: Ctx) {
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    const b = await seedProduct(ctx, { stock: 5 });
    const draft = await createDraftOrder(
      ctx,
      draftInput(customer.id, [{ productId: a.id, quantity: 1 }]),
    );
    // An earlier edit (revision 2) reserved its line and then crashed before Transaction 2.
    const staleKey = holdKey(draft.id, 2, 0);
    await actualStock.reserveStock(ctx.organizationId, b.id, "default", 2, staleKey);
    await db()
      .collection("orders")
      .doc(draft.id)
      .update({
        pendingLines: [lineOf(b, 2, staleKey)],
        revision: 2,
        updatedAt: updatedAgo(STALE_EDIT_MS + 60_000), // untouched for over 5 minutes: stale
      });
    return { draft, a, b, staleKey };
  }

  it("an edit releases pendingLines left by an older revision, then proceeds", async () => {
    const ctx = newCtx();
    const { draft, a, b, staleKey } = await draftWithStalePending(ctx);

    const updated = await updateDraftOrder(ctx, draft.id, {
      lines: [{ productId: b.id, quantity: 1 }],
    });

    expect(updated).toMatchObject({ revision: 3, stockState: "held", pendingLines: null });
    expect(updated.lines.map((l) => l.holdKey)).toEqual([holdKey(draft.id, 3, 0)]);
    expect(await reservation(b.id, "default", staleKey)).toMatchObject({ status: "released" });
    expect(await counts(b.id)).toEqual({ onHand: 5, reserved: 1 });
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 0 });
  });

  it("a patch without lines also releases stale pendingLines", async () => {
    const ctx = newCtx();
    const { draft, a, b, staleKey } = await draftWithStalePending(ctx);

    const updated = await updateDraftOrder(ctx, draft.id, { notes: "Gift wrap" });

    expect(updated).toMatchObject({ revision: 2, pendingLines: null, notes: "Gift wrap" });
    expect(await reservation(b.id, "default", staleKey)).toMatchObject({ status: "released" });
    expect(await counts(b.id)).toEqual({ onHand: 5, reserved: 0 });
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 1 });
  });
});

describe("edits racing in-flight reservations (R10)", () => {
  it("an edit while pendingLines are fresh (an edit in flight) is refused and touches nothing", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    const b = await seedProduct(ctx, { stock: 5 });
    const draft = await createDraftOrder(
      ctx,
      draftInput(customer.id, [{ productId: a.id, quantity: 1 }]),
    );
    const inFlightKey = holdKey(draft.id, 2, 0);
    await actualStock.reserveStock(ctx.organizationId, b.id, "default", 2, inFlightKey);
    await db()
      .collection("orders")
      .doc(draft.id)
      .update({
        pendingLines: [lineOf(b, 2, inFlightKey)],
        revision: 2,
        updatedAt: updatedAgo(STALE_EDIT_MS - 60_000), // 4 minutes ago: still inside the window
      });

    for (const call of [
      () => updateDraftOrder(ctx, draft.id, { notes: "x" }),
      () => updateDraftOrder(ctx, draft.id, { lines: [{ productId: b.id, quantity: 1 }] }),
    ]) {
      const err = await rejection(call());
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).message).toBe("Another change to this order is in progress");
    }
    const stored = await rawOrder(draft.id);
    expect(stored.revision).toBe(2);
    expect(stored.pendingLines.map((l: { holdKey: string }) => l.holdKey)).toEqual([inFlightKey]);
    expect(await reservation(b.id, "default", inFlightKey)).toMatchObject({ status: "reserved" });
    expect(await counts(b.id)).toEqual({ onHand: 5, reserved: 2 });
  });

  it("an edit of a draft whose holds are still pending is refused", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    const orderId = await writePendingDraft(
      ctx,
      customer.id,
      [{ product: a, quantity: 1 }],
      `key-${randomUUID()}`,
    );

    for (const call of [
      () => updateDraftOrder(ctx, orderId, { notes: "x" }),
      () => updateDraftOrder(ctx, orderId, { lines: [{ productId: a.id, quantity: 2 }] }),
    ]) {
      const err = await rejection(call());
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).message).toBe("This order is still being prepared, try again");
    }
    const stored = await rawOrder(orderId);
    expect(stored).toMatchObject({ revision: 1, stockState: "pending", pendingLines: null });
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 0 });
  });

  it("when both the release and the park of late-reserved lines fail, the error is rethrown", async () => {
    warnings = "expected";
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    seam.beforeReserve = async (key) => {
      seam.beforeReserve = null;
      // The order vanishes (so parking fails) and releases fail.
      await db().collection("orders").doc(orderIdOfKey(key)!).delete();
      seam.failRelease = true;
    };

    const err = await rejection(
      createDraftOrder(ctx, draftInput(customer.id, [{ productId: a.id, quantity: 1 }])),
    );

    expect(err).not.toBeInstanceOf(OrderExpiredError);
    expect((err as Error).message).toBe("Order is missing");
    expect(warn).toHaveBeenCalledWith("order stock to release could not be recorded", {
      orderId: expect.any(String),
    });
  });

  it("a resumed replay that hits busy on an order already held neither cancels it nor releases its holds", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const a = await seedProduct(ctx, { stock: 5 });
    const key = `key-${randomUUID()}`;
    const orderId = await writePendingDraft(ctx, customer.id, [{ product: a, quantity: 2 }], key);
    const lineKey = holdKey(orderId, 1, 0);
    seam.beforeReserve = async () => {
      seam.beforeReserve = null;
      // The original creator finishes first (reserve + Transaction B) ...
      await actualStock.reserveStock(ctx.organizationId, a.id, "default", 2, lineKey);
      const ref = db().collection("orders").doc(orderId);
      const lines = (await ref.get()).data()!.lines as Array<Record<string, unknown>>;
      await ref.update({
        stockState: "held",
        lines: lines.map((l) => ({ ...l, holdState: "held" })),
      });
      // ... and the replay's own reserve then loses to contention.
      throw new InventoryBusyError();
    };

    const order = await createDraftOrder(
      ctx,
      draftInput(customer.id, [{ productId: a.id, quantity: 2 }], { idempotencyKey: key }),
    );

    expect(order).toMatchObject({ id: orderId, status: "draft", stockState: "held" });
    expect(await rawOrder(orderId)).toMatchObject({ status: "draft", stockState: "held" });
    expect(await reservation(a.id, "default", lineKey)).toMatchObject({ status: "reserved" });
    expect(await counts(a.id)).toEqual({ onHand: 5, reserved: 2 });
    const types = (await docsOf("orderEvents", ctx.organizationId)).map((d) => d.data().type);
    expect(types).not.toContain("status_changed");
  });
});
