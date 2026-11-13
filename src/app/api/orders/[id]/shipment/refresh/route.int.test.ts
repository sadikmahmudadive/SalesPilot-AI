import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/security/permissions";
import { createCourierAccount } from "@/repositories/couriers";
import { customerInputSchema } from "@/schemas/customer";
import { shippingAddressSchema } from "@/schemas/order";
import { productInputSchema } from "@/schemas/product";
import { createCustomer } from "@/services/crm/customers";
import { bookShipment } from "@/services/couriers/booking";
import { adjustStock } from "@/services/inventory/stock";
import { createDraftOrder } from "@/services/orders/drafts";
import { confirmOrder } from "@/services/orders/lifecycle";
import type { OrderCtx } from "@/services/orders/settings";
import { createProduct } from "@/services/products/products";

import { POST } from "./route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

const orgs = new Set<string>();

async function seed(role: Role = "agent") {
  const organizationId = `org-${randomUUID()}`;
  const uid = `uid-${randomUUID()}`;
  const db = adminDb();
  await db
    .collection("users")
    .doc(uid)
    .set({ uid, email: `${uid}@test.com`, defaultOrganizationId: organizationId });
  await db
    .collection("organizationMembers")
    .doc(`${organizationId}_${uid}`)
    .set({ organizationId, uid, role });
  orgs.add(organizationId);
  return { uid, organizationId };
}

const signIn = (uid: string) => {
  session = { uid, email: `${uid}@test.com` };
};

let phoneCounter = 0;
const phone = () => `01713${String(1000000 + ++phoneCounter).slice(1)}`;

async function seedOrder(ctx: OrderCtx) {
  const customer = await createCustomer(
    ctx,
    customerInputSchema.parse({ fullName: "Karim", phone: phone() }),
  );
  const product = await createProduct(
    ctx,
    productInputSchema.parse({
      name: `Book ${randomUUID().slice(0, 6)}`,
      sku: `sku-${randomUUID().slice(0, 8)}`,
      regularPriceMinor: 50000,
      availability: "active",
      variants: [],
    }),
  );
  await adjustStock(ctx, product.id, "default", { delta: 10, reason: "seed" });
  const draft = await createDraftOrder(ctx, {
    customerId: customer.id,
    lines: [{ productId: product.id, quantity: 1 }],
    shippingAddress: shippingAddressSchema.parse({
      recipientName: "Karim",
      phone: "01712345678",
      line1: "House 1, Road 2",
      zone: "inside_dhaka",
    }),
    paymentMethod: "cod",
    discountMinor: 0,
    idempotencyKey: `key-${randomUUID()}`,
    source: "staff",
  });
  return confirmOrder(ctx, draft.id);
}

describe("POST /api/orders/[id]/shipment/refresh", () => {
  beforeEach(() => {
    session = null;
  });

  afterAll(async () => {
    const db = adminDb();
    for (const orgId of orgs) {
      const orders = await db.collection("orders").where("organizationId", "==", orgId).get();
      for (const d of orders.docs) await d.ref.delete();
      const accounts = await db.collection("courierAccounts").where("organizationId", "==", orgId).get();
      for (const d of accounts.docs) await d.ref.delete();
    }
  });

  it("requires authentication", async () => {
    const res = await POST(
      new Request("http://localhost/api/orders/ord_123/shipment/refresh", { method: "POST" }),
      { params: Promise.resolve({ id: "ord_123" }) },
    );
    expect(res.status).toBe(401);
  });

  it("refreshes booked shipment status successfully", async () => {
    const { uid, organizationId } = await seed("agent");
    signIn(uid);
    const ctx: OrderCtx = { organizationId, uid };

    const order = await seedOrder(ctx);
    const account = await createCourierAccount({
      organizationId,
      provider: "mock",
      label: "Mock Express",
      mode: "mock",
      enabled: true,
      isDefault: true,
      credentials: { v: 1, iv: "iv", tag: "tag", data: "data" },
      publicConfig: {},
    });

    await bookShipment(ctx, order.id, {
      courierAccountId: account.id,
      weightKg: 1.0,
    });

    const res = await POST(
      new Request(`http://localhost/api/orders/${order.id}/shipment/refresh`, { method: "POST" }),
      { params: Promise.resolve({ id: order.id }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shipment).toBeDefined();
    expect(body.shipment.status).toBe("booked");
    expect(body.shipment.lastSyncedAt).toBeDefined();
  });
});
