import { randomUUID } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { customerInputSchema } from "@/schemas/customer";
import { orderListQuerySchema, shippingAddressSchema, type Order } from "@/schemas/order";
import { productInputSchema } from "@/schemas/product";
import { createCustomer } from "@/services/crm/customers";
import { adjustStock } from "@/services/inventory/stock";
import { createProduct } from "@/services/products/products";

import { createDraftOrder } from "./drafts";
import { confirmOrder } from "./lifecycle";
import {
  getOrder,
  isOrderExpired,
  listCustomerOrders,
  listOrderEvents,
  listOrders,
} from "./queries";

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

async function seedCustomer(ctx: Ctx) {
  return createCustomer(ctx, customerInputSchema.parse({ fullName: "Md. Karim", phone: phone() }));
}

async function seedProduct(ctx: Ctx) {
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
  await adjustStock(ctx, product.id, "default", { delta: 100, reason: "seed" });
  return product;
}

async function draft(ctx: Ctx, customerId: string, productId: string): Promise<Order> {
  return createDraftOrder(ctx, {
    customerId,
    lines: [{ productId, quantity: 1 }],
    shippingAddress: shippingAddressSchema.parse({
      recipientName: "Karim",
      phone: "01712345678",
      line1: "House 1",
      zone: "outside_dhaka",
    }),
    paymentMethod: "cod",
    discountMinor: 0,
    idempotencyKey: `key-${randomUUID()}`,
    source: "staff",
  });
}

async function docsOf(collection: string, organizationId: string) {
  return (await db().collection(collection).where("organizationId", "==", organizationId).get())
    .docs;
}

const query = (q: Partial<Record<string, unknown>> = {}) => orderListQuerySchema.parse(q);

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error("expected a rejection");
    },
    (err: unknown) => err,
  );
}

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

// One organization with three orders: SP-000001 (customer A, draft), SP-000002 (customer B,
// confirmed), SP-000003 (customer A, draft). Plus another organization with one order.
async function buildFixture() {
  const ctx = newCtx();
  const a = await seedCustomer(ctx);
  const b = await seedCustomer(ctx);
  const product = await seedProduct(ctx);
  const o1 = await draft(ctx, a.id, product.id);
  const o2 = await draft(ctx, b.id, product.id);
  const o3 = await draft(ctx, a.id, product.id);
  await confirmOrder(ctx, o2.id);

  const other = newCtx();
  const oc = await seedCustomer(other);
  const op = await seedProduct(other);
  const foreign = await draft(other, oc.id, op.id);
  return { ctx, a, b, o1, o2, o3, other, foreign };
}
let cached: ReturnType<typeof buildFixture> | null = null;
const fixture = () => (cached ??= buildFixture());

describe("listOrders", () => {
  it("lists newest first and filters by status", async () => {
    const { ctx, o1, o2, o3 } = await fixture();
    expect((await listOrders(ctx, query())).items.map((o) => o.id)).toEqual([o3.id, o2.id, o1.id]);
    const drafts = await listOrders(ctx, query({ status: "draft" }));
    expect(drafts.items.map((o) => o.id)).toEqual([o3.id, o1.id]);
    const confirmed = await listOrders(ctx, query({ status: "confirmed" }));
    expect(confirmed.items.map((o) => o.orderNumber)).toEqual(["SP-000002"]);
  });

  it("paginates with a cursor", async () => {
    const { ctx, o1, o2, o3 } = await fixture();
    const first = await listOrders(ctx, query({ limit: 2 }));
    expect(first.items.map((o) => o.id)).toEqual([o3.id, o2.id]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await listOrders(ctx, query({ limit: 2, cursor: first.nextCursor }));
    expect(second.items.map((o) => o.id)).toEqual([o1.id]);
    expect(second.nextCursor).toBeNull();
  });

  it("finds an order by number (case-insensitive), never another organization's", async () => {
    const { ctx, o2, other, foreign } = await fixture();
    const page = await listOrders(ctx, query({ q: "SP-000002" }));
    expect(page).toEqual({ items: [expect.objectContaining({ id: o2.id })], nextCursor: null });
    expect((await listOrders(ctx, query({ q: "sp-000002" }))).items).toHaveLength(1);
    expect((await listOrders(ctx, query({ q: "SP-000099" }))).items).toEqual([]);
    // The other organization's SP-000001 is invisible from ours, and ours from theirs.
    const theirs = await listOrders(other, query({ q: foreign.orderNumber }));
    expect(theirs.items.map((o) => o.id)).toEqual([foreign.id]);
    expect((await listOrders(other, query({ q: "SP-000002" }))).items).toEqual([]);
    // Other filters still apply to an order-number match.
    expect((await listOrders(ctx, query({ q: "SP-000002", status: "draft" }))).items).toEqual([]);
  });

  it("finds orders by the customer's phone", async () => {
    const { ctx, a, o1, o3 } = await fixture();
    const local = `0${a.phoneE164.slice(4)}`; // +8801714... -> 01714...
    const page = await listOrders(ctx, query({ q: local }));
    expect(page.items.map((o) => o.id)).toEqual([o3.id, o1.id]);
  });

  it("filters by customerId and paymentStatus", async () => {
    const { ctx, b, o2 } = await fixture();
    expect((await listOrders(ctx, query({ customerId: b.id }))).items.map((o) => o.id)).toEqual([
      o2.id,
    ]);
    const cod = await listOrders(ctx, query({ paymentStatus: "cod_pending" }));
    expect(cod.items).toHaveLength(3);
  });

  it("filters by a createdAt range", async () => {
    const { ctx, o2, o3 } = await fixture();
    const from = new Date(Date.parse(o2.createdAt)).toISOString();
    const page = await listOrders(ctx, query({ from }));
    expect(page.items.map((o) => o.id)).toEqual([o3.id, o2.id]);
    const to = new Date(Date.parse(o2.createdAt) + 1).toISOString();
    const until = await listOrders(ctx, query({ status: "confirmed", from, to }));
    expect(until.items.map((o) => o.id)).toEqual([o2.id]);
    expect(
      await rejection(listOrders(ctx, query({ from: o3.createdAt, to: o2.createdAt }))),
    ).toBeInstanceOf(ValidationError);
  });

  it("rejects an unsearchable q and filter combinations without an index", async () => {
    const { ctx, b } = await fixture();
    const bad = await rejection(listOrders(ctx, query({ q: "hello" })));
    expect(bad).toBeInstanceOf(ValidationError);
    expect((bad as ValidationError).details?.[0]?.path).toBe("q");
    expect(
      await rejection(listOrders(ctx, query({ status: "draft", customerId: b.id }))),
    ).toBeInstanceOf(ValidationError);
    expect(
      await rejection(listOrders(ctx, query({ status: "draft", q: b.phoneE164 }))),
    ).toBeInstanceOf(ValidationError);
  });
});

describe("getOrder", () => {
  it("returns the order with expired=false, and another organization's order is NotFound", async () => {
    const { ctx, o2, foreign } = await fixture();
    const got = await getOrder(ctx, o2.id);
    expect(got).toMatchObject({ id: o2.id, status: "confirmed", expired: false });
    expect(await rejection(getOrder(ctx, foreign.id))).toBeInstanceOf(NotFoundError);
    expect(await rejection(getOrder(ctx, "../bad"))).toBeInstanceOf(NotFoundError);
  });

  it("marks a draft past its hold as expired", async () => {
    const ctx = newCtx();
    const customer = await seedCustomer(ctx);
    const product = await seedProduct(ctx);
    const order = await draft(ctx, customer.id, product.id);
    expect((await getOrder(ctx, order.id)).expired).toBe(false);
    await db()
      .collection("orders")
      .doc(order.id)
      .update({ holdExpiresAt: Timestamp.fromMillis(Date.now() - 60_000) });
    expect((await getOrder(ctx, order.id)).expired).toBe(true);
  });
});

describe("isOrderExpired", () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  it("holds for drafts and unpaid confirmed online orders past their hold only", () => {
    expect(
      isOrderExpired({ status: "draft", paymentStatus: "cod_pending", holdExpiresAt: past }),
    ).toBe(true);
    expect(
      isOrderExpired({ status: "draft", paymentStatus: "cod_pending", holdExpiresAt: future }),
    ).toBe(false);
    for (const p of ["awaiting_payment", "failed"] as const) {
      expect(isOrderExpired({ status: "confirmed", paymentStatus: p, holdExpiresAt: past })).toBe(
        true,
      );
    }
    expect(
      isOrderExpired({ status: "confirmed", paymentStatus: "paid", holdExpiresAt: past }),
    ).toBe(false);
    expect(
      isOrderExpired({ status: "confirmed", paymentStatus: "cod_pending", holdExpiresAt: null }),
    ).toBe(false);
    expect(
      isOrderExpired({
        status: "processing",
        paymentStatus: "awaiting_payment",
        holdExpiresAt: past,
      }),
    ).toBe(false);
  });
});

describe("listOrderEvents", () => {
  it("returns the timeline oldest first; another organization's order is NotFound", async () => {
    const { ctx, o2, foreign } = await fixture();
    const events = await listOrderEvents(ctx, o2.id);
    expect(events.map((e) => e.type)).toEqual(["created", "status_changed"]);
    expect(events[1]).toMatchObject({ from: "draft", to: "confirmed" });
    expect(Date.parse(events[0]!.createdAt)).toBeLessThanOrEqual(Date.parse(events[1]!.createdAt));
    expect(await rejection(listOrderEvents(ctx, foreign.id))).toBeInstanceOf(NotFoundError);
  });
});

describe("listCustomerOrders", () => {
  it("returns the customer's orders newest first, default 5, honouring limit", async () => {
    const { ctx, a, o1, o3 } = await fixture();
    expect((await listCustomerOrders(ctx, a.id)).map((o) => o.id)).toEqual([o3.id, o1.id]);
    expect((await listCustomerOrders(ctx, a.id, 1)).map((o) => o.id)).toEqual([o3.id]);
    expect(await rejection(listCustomerOrders(ctx, a.id, 0))).toBeInstanceOf(ValidationError);
  });
});
