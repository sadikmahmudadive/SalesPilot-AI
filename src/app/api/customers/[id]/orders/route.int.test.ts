import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/security/permissions";
import { customerInputSchema } from "@/schemas/customer";
import { shippingAddressSchema } from "@/schemas/order";
import { productInputSchema } from "@/schemas/product";
import { createCustomer } from "@/services/crm/customers";
import { adjustStock } from "@/services/inventory/stock";
import { createDraftOrder } from "@/services/orders/drafts";
import { createProduct } from "@/services/products/products";

import { GET } from "./route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

const orgs = new Set<string>();
const uids: string[] = [];
let counter = 0;
const phone = () => `01714${String(2000000 + ++counter).slice(1)}`;

async function seed(role: Role, organizationId = `org-${randomUUID()}`) {
  const uid = `uid-${randomUUID()}`;
  const db = adminDb();
  await db
    .collection("users")
    .doc(uid)
    .set({ uid, email: `${uid}@x.com`, defaultOrganizationId: organizationId });
  await db
    .collection("organizationMembers")
    .doc(`${organizationId}_${uid}`)
    .set({ organizationId, uid, role });
  orgs.add(organizationId);
  uids.push(uid);
  return { uid, organizationId };
}
const signIn = (uid: string) => {
  session = { uid, email: `${uid}@x.com` };
};

/** A customer, a stocked product and `orderCount` draft orders for the customer. */
async function seedCustomerWithOrders(organizationId: string, uid: string, orderCount: number) {
  const ctx = { organizationId, uid };
  const customer = await createCustomer(
    ctx,
    customerInputSchema.parse({ fullName: "Md. Rahim", phone: phone() }),
  );
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
  const orderIds: string[] = [];
  for (let i = 0; i < orderCount; i++) {
    const order = await createDraftOrder(ctx, {
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: 1 }],
      shippingAddress: shippingAddressSchema.parse({
        recipientName: "Rahim",
        phone: "01712345678",
        line1: "House 1, Road 2",
        zone: "inside_dhaka",
      }),
      paymentMethod: "cod",
      discountMinor: 0,
      idempotencyKey: `key-${randomUUID()}`,
      source: "staff",
    });
    orderIds.push(order.id);
  }
  return { customerId: customer.id, orderIds };
}

const get = (customerId: string) =>
  GET(new Request(`http://localhost/api/customers/${customerId}/orders`), {
    params: Promise.resolve({ id: customerId }),
  });

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as Json;

beforeEach(() => {
  session = null;
});

afterAll(async () => {
  const db = adminDb();
  for (const org of orgs) {
    const inventory = await db.collection("inventory").where("organizationId", "==", org).get();
    for (const d of inventory.docs) await db.recursiveDelete(d.ref);
    for (const col of [
      "orders",
      "orderEvents",
      "orderCounters",
      "orderNumbers",
      "orderIdempotency",
      "orderSettings",
      "auditLogs",
      "products",
      "productSkus",
      "productSlugs",
      "customers",
      "customerPhones",
    ]) {
      const snap = await db.collection(col).where("organizationId", "==", org).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  }
  await Promise.all(
    uids.flatMap((u) => [
      db.collection("users").doc(u).delete(),
      ...[...orgs].map((o) => db.collection("organizationMembers").doc(`${o}_${u}`).delete()),
    ]),
  );
});

describe("GET /api/customers/[id]/orders", () => {
  it("401 without a session and 403 without membership", async () => {
    expect((await get("x")).status).toBe(401);
    signIn(`uid-${randomUUID()}`);
    expect((await get("x")).status).toBe(403);
  });

  it("a viewer gets the customer's own orders, newest first", async () => {
    const owner = await seed("owner");
    const a = await seedCustomerWithOrders(owner.organizationId, owner.uid, 2);
    const b = await seedCustomerWithOrders(owner.organizationId, owner.uid, 1);
    const viewer = await seed("viewer", owner.organizationId);
    signIn(viewer.uid);

    const res = await get(a.customerId);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.items.map((o: Json) => o.id)).toEqual([...a.orderIds].reverse());
    expect(body.items.every((o: Json) => o.customerId === a.customerId)).toBe(true);
    expect(body.items.every((o: Json) => o.organizationId === owner.organizationId)).toBe(true);
    expect((await json(await get(b.customerId))).items).toHaveLength(1);
  });

  it("returns an empty list for a customer without orders", async () => {
    const owner = await seed("owner");
    const none = await seedCustomerWithOrders(owner.organizationId, owner.uid, 0);
    signIn(owner.uid);
    expect(await json(await get(none.customerId))).toEqual({ items: [] });
  });

  it("returns at most the 5 newest orders", async () => {
    const owner = await seed("owner");
    const many = await seedCustomerWithOrders(owner.organizationId, owner.uid, 7);
    signIn(owner.uid);
    const body = await json(await get(many.customerId));
    expect(body.items.map((o: Json) => o.id)).toEqual([...many.orderIds].reverse().slice(0, 5));
  });

  it("another organization's customer, an unknown one and a bad id are the same 404", async () => {
    const owner = await seed("owner");
    const mine = await seedCustomerWithOrders(owner.organizationId, owner.uid, 1);
    const theirs = await seed("owner");
    const other = await seedCustomerWithOrders(theirs.organizationId, theirs.uid, 1);
    signIn(owner.uid);

    const cross = await get(other.customerId);
    const missing = await get(`missing-${randomUUID()}`);
    const bad = await get("a/b");
    for (const res of [cross, missing, bad]) expect(res.status).toBe(404);
    const crossBody = await json(cross);
    const errorOf = (body: Json) => ({ code: body.error.code, message: body.error.message });
    expect(errorOf(crossBody)).toEqual({ code: "NOT_FOUND", message: "Resource not found" });
    expect(errorOf(await json(missing))).toEqual(errorOf(crossBody));
    expect(errorOf(await json(bad))).toEqual(errorOf(crossBody));
    expect(JSON.stringify(crossBody)).not.toContain(other.orderIds[0]);

    // And the other organization's customer sees none of ours.
    signIn(theirs.uid);
    expect((await get(mine.customerId)).status).toBe(404);
  });
});
