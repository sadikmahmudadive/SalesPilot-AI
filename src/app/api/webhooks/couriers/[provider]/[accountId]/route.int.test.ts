import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { adminDb } from "@/lib/firebase/admin";
import { sealSecret } from "@/lib/security/secret-box";
import { createCourierAccount } from "@/repositories/couriers";
import { orderRepo } from "@/repositories/orders";
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

const TEST_KEY = Buffer.alloc(32, 1).toString("base64");
process.env.ENCRYPTION_KEY = TEST_KEY;

const orgs = new Set<string>();

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

describe("POST /api/webhooks/couriers/[provider]/[accountId]", () => {
  afterAll(async () => {
    const db = adminDb();
    for (const orgId of orgs) {
      const orders = await db.collection("orders").where("organizationId", "==", orgId).get();
      for (const d of orders.docs) await d.ref.delete();
      const accounts = await db.collection("courierAccounts").where("organizationId", "==", orgId).get();
      for (const d of accounts.docs) await d.ref.delete();
    }
  });

  it("handles valid webhook POST and updates order status", async () => {
    const organizationId = `org-${randomUUID()}`;
    orgs.add(organizationId);
    const ctx: OrderCtx = { organizationId, uid: `uid-${randomUUID()}` };

    const order = await seedOrder(ctx);
    const account = await createCourierAccount({
      organizationId,
      provider: "mock",
      label: "Mock Express",
      mode: "mock",
      enabled: true,
      isDefault: true,
      credentials: { v: 1, iv: "iv", tag: "tag", data: "data" },
      webhookSecret: sealSecret("test_webhook_secret", TEST_KEY),
      publicConfig: {},
    });

    const booked = await bookShipment(ctx, order.id, {
      courierAccountId: account.id,
      weightKg: 1.0,
    });

    const res = await POST(
      new Request(`http://localhost/api/webhooks/couriers/mock/${account.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-secret": "test_webhook_secret",
        },
        body: JSON.stringify({
          invoice: order.orderNumber,
          consignmentId: booked.shipment?.consignmentId,
          status: "in_transit",
        }),
      }),
      { params: Promise.resolve({ provider: "mock", accountId: account.id }) },
    );

    expect(res.status).toBe(200);
    const stored = (await orderRepo.get(organizationId, order.id))!;
    expect(stored.shipment?.status).toBe("in_transit");
  });

  it("returns 401 when webhook authentication fails", async () => {
    const organizationId = `org-${randomUUID()}`;
    orgs.add(organizationId);

    const account = await createCourierAccount({
      organizationId,
      provider: "mock",
      label: "Mock Express",
      mode: "mock",
      enabled: true,
      isDefault: true,
      credentials: { v: 1, iv: "iv", tag: "tag", data: "data" },
      webhookSecret: sealSecret("correct_secret", TEST_KEY),
      publicConfig: {},
    });

    const res = await POST(
      new Request(`http://localhost/api/webhooks/couriers/mock/${account.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-secret": "wrong_secret",
        },
        body: JSON.stringify({ status: "delivered" }),
      }),
      { params: Promise.resolve({ provider: "mock", accountId: account.id }) },
    );

    expect(res.status).toBe(401);
  });
});
