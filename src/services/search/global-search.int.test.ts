import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminDb } from "@/lib/firebase/admin";
import { conversationRepo } from "@/repositories/conversations";
import { customerInputSchema } from "@/schemas/customer";
import { orderCreateSchema } from "@/schemas/order";
import { productInputSchema } from "@/schemas/product";
import { createCustomer } from "@/services/crm/customers";
import { adjustStock } from "@/services/inventory/stock";
import { createDraftOrder } from "@/services/orders/drafts";
import { createProduct } from "@/services/products/products";

import { globalSearch, SEARCH_GROUP_LIMIT } from "./global-search";

const ORG = `org-${randomUUID()}`;
const OTHER = `org-${randomUUID()}`;
const ctx = { organizationId: ORG, uid: "uid-search", role: "owner" as const };
const db = () => adminDb();

let customerId: string;
let productId: string;
let orderId: string;
let orderNumber: string;
let conversationId: string;

beforeAll(async () => {
  const customer = await createCustomer(
    ctx,
    customerInputSchema.parse({ fullName: "Nadia Rahman", phone: "01711223344" }),
  );
  customerId = customer.id;
  const product = await createProduct(
    ctx,
    productInputSchema.parse({
      name: "Linen Panjabi",
      sku: "LP-RED-42",
      regularPriceMinor: 150000,
      availability: "active",
    }),
  );
  productId = product.id;
  await adjustStock(ctx, productId, "default", { delta: 5, reason: "seed" });
  const body = orderCreateSchema.parse({
    customerId,
    lines: [{ productId, quantity: 1 }],
    shippingAddress: {
      recipientName: "Nadia",
      phone: "01711223344",
      line1: "Road 1",
      zone: "inside_dhaka",
    },
    paymentMethod: "cod",
    idempotencyKey: `search-${randomUUID()}`,
  });
  const order = await createDraftOrder(ctx, { ...body, source: "staff" });
  orderId = order.id;
  orderNumber = order.orderNumber;
  const conv = await conversationRepo.create(ORG, {
    channel: "whatsapp",
    contactPhoneE164: "+8801711223344",
    contactName: "Nadia Rahman",
    customerId,
    assignedAgentId: null,
    assignedUserId: null,
    status: "needs_reply",
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: new Date().toISOString(),
    searchLower: "nadia rahman +8801711223344",
  });
  conversationId = conv.id;

  // Another workspace with look-alike data must never show up.
  await createCustomer(
    { organizationId: OTHER, uid: "uid-other" },
    customerInputSchema.parse({ fullName: "Nadia Other", phone: "01711223355" }),
  );
});

afterAll(async () => {
  for (const col of [
    "customers",
    "customerPhones",
    "products",
    "productSkus",
    "productSlugs",
    "inventory",
    "orders",
    "conversations",
  ]) {
    for (const org of [ORG, OTHER]) {
      const snap = await db().collection(col).where("organizationId", "==", org).get();
      await Promise.all(snap.docs.map((d) => db().recursiveDelete(d.ref)));
    }
  }
});

const ids = (hits: Array<{ id: string }> | null) => (hits ?? []).map((h) => h.id);

describe("globalSearch", () => {
  it("finds a customer and a conversation by name, with links", async () => {
    const r = await globalSearch(ctx, "nadia");
    expect(ids(r.customers)).toEqual([customerId]);
    expect(r.customers![0]).toMatchObject({
      title: "Nadia Rahman",
      href: `/customers/${customerId}`,
    });
    expect(ids(r.conversations)).toEqual([conversationId]);
    expect(r.conversations![0]!.href).toBe(`/inbox?c=${conversationId}`);
    expect(r.orders).toEqual([]); // a name is not an order search
  });

  it("finds a product by name and by SKU", async () => {
    expect(ids((await globalSearch(ctx, "linen")).products)).toEqual([productId]);
    const bySku = await globalSearch(ctx, "LP-RED");
    expect(ids(bySku.products)).toEqual([productId]);
    expect(bySku.products![0]).toMatchObject({ href: `/products/${productId}` });
  });

  it("finds an order by its number", async () => {
    const r = await globalSearch(ctx, orderNumber.toLowerCase());
    expect(ids(r.orders)).toEqual([orderId]);
    expect(r.orders![0]).toMatchObject({ title: orderNumber, href: `/orders/${orderId}` });
  });

  it("phone query searches every group without errors", async () => {
    const r = await globalSearch(ctx, "01711223344");
    expect(ids(r.customers)).toEqual([customerId]);
    expect(ids(r.orders)).toEqual([orderId]);
    expect(ids(r.conversations)).toEqual([conversationId]);
    expect(r.products).toEqual([]);
  });

  it("only returns this workspace's records", async () => {
    const r = await globalSearch(ctx, "nadia o");
    expect(r.customers).toEqual([]);
  });

  it("omits groups the role cannot read", async () => {
    const r = await globalSearch(ctx, "nadia", {
      can: (perm) => perm !== "orders:read" && perm !== "inbox:read",
    });
    expect(r.orders).toBeNull();
    expect(r.conversations).toBeNull();
    expect(ids(r.customers)).toEqual([customerId]);
  });

  it("caps each group", () => {
    expect(SEARCH_GROUP_LIMIT).toBe(5);
  });
});
