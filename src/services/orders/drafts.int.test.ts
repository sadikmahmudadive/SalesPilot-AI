import { randomUUID } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { InventoryBusyError, NotFoundError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { customerInputSchema } from "@/schemas/customer";
import { shippingAddressSchema, type Order, type OrderLineInput } from "@/schemas/order";
import { productInputSchema, type Product } from "@/schemas/product";
import { createCustomer } from "@/services/crm/customers";
import { adjustStock } from "@/services/inventory/stock";
import { archiveProduct, createProduct } from "@/services/products/products";

import { createDraftOrder, updateDraftOrder, type DraftInput } from "./drafts";
import { OrderExpiredError, OrderTransitionError } from "./state-machine";
import { OrderLineError, holdKey } from "./stock-holds";

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

beforeEach(() => {
  seam.beforeReserve = null;
  seam.failRelease = false;
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
    const types = (await docsOf("orderEvents", ctx.organizationId)).map((d) => d.data().type);
    expect(types.sort()).toEqual(["created", "status_changed"]);
  });

  it("a release failure during compensation still cancels, leaves stockState releasing and rethrows the original error", async () => {
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

  it("a patch without lines re-prices and keeps the holds", async () => {
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
