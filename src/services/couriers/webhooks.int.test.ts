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
import { adjustStock } from "@/services/inventory/stock";
import { createDraftOrder, type DraftInput } from "@/services/orders/drafts";
import { confirmOrder } from "@/services/orders/lifecycle";
import type { OrderCtx } from "@/services/orders/settings";
import { createProduct } from "@/services/products/products";

import { bookShipment } from "./booking";
import { handleCourierWebhook } from "./webhooks";

const TEST_KEY = Buffer.alloc(32, 1).toString("base64");
process.env.ENCRYPTION_KEY = TEST_KEY;

const orgs: string[] = [];
function newCtx(): OrderCtx {
  const organizationId = `org-${randomUUID()}`;
  orgs.push(organizationId);
  return { organizationId, uid: `uid-${randomUUID()}` };
}
type Ctx = ReturnType<typeof newCtx>;

let phoneCounter = 0;
const phone = () => `01713${String(1000000 + ++phoneCounter).slice(1)}`;

async function seedProduct(ctx: Ctx, stockUnits: number) {
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
  await adjustStock(ctx, product.id, "default", { delta: stockUnits, reason: "seed" });
  return product;
}

const address = () =>
  shippingAddressSchema.parse({
    recipientName: "Hasan",
    phone: "01712345678",
    line1: "Road 11",
    zone: "inside_dhaka",
  });

async function seedConfirmedOrder(ctx: Ctx) {
  const customer = await createCustomer(
    ctx,
    customerInputSchema.parse({ fullName: "Hasan Mahmud", phone: phone() }),
  );
  const product = await seedProduct(ctx, 10);
  const input: DraftInput = {
    customerId: customer.id,
    lines: [{ productId: product.id, quantity: 2 }],
    shippingAddress: address(),
    paymentMethod: "cod",
    discountMinor: 0,
    idempotencyKey: `key-${randomUUID()}`,
    source: "staff",
  };
  const draft = await createDraftOrder(ctx, input);
  const confirmed = await confirmOrder(ctx, draft.id);
  return { order: confirmed, product, customer };
}

describe("Courier webhooks service", () => {
  afterAll(async () => {
    const db = adminDb();
    for (const orgId of orgs) {
      const orders = await db.collection("orders").where("organizationId", "==", orgId).get();
      for (const d of orders.docs) await d.ref.delete();
      const accounts = await db.collection("courierAccounts").where("organizationId", "==", orgId).get();
      for (const d of accounts.docs) await d.ref.delete();
      const events = await db.collection("orderEvents").where("organizationId", "==", orgId).get();
      for (const d of events.docs) await d.ref.delete();
    }
  });

  it("answers challenge handshake for pathao", async () => {
    const ctx = newCtx();
    const account = await createCourierAccount({
      organizationId: ctx.organizationId,
      provider: "pathao",
      label: "Pathao Test",
      mode: "mock",
      enabled: true,
      isDefault: true,
      credentials: sealSecret(
        JSON.stringify({ client_id: "id", client_secret: "sec", username: "u", password: "p" }),
        TEST_KEY,
      ),
      publicConfig: {},
    });

    const req = new Request(
      `http://localhost/api/webhooks/couriers/pathao/${account.id}?hub.challenge=test_challenge_123`,
      { method: "GET" },
    );

    const res = await handleCourierWebhook("pathao", account.id, req);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("test_challenge_123");
  });

  it("rejects unauthorized webhook requests", async () => {
    const ctx = newCtx();
    const account = await createCourierAccount({
      organizationId: ctx.organizationId,
      provider: "mock",
      label: "Mock Courier",
      mode: "mock",
      enabled: true,
      isDefault: true,
      credentials: { v: 1, iv: "iv", tag: "tag", data: "data" },
      webhookSecret: sealSecret("secret_key_123", TEST_KEY),
      publicConfig: {},
    });

    const req = new Request(`http://localhost/api/webhooks/couriers/mock/${account.id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mock-secret": "wrong_secret",
      },
      body: JSON.stringify({ consignmentId: "cid_1", status: "delivered" }),
    });

    const res = await handleCourierWebhook("mock", account.id, req);
    expect(res.status).toBe(401);
  });

  it("processes inbound status update and triggers order lifecycle (shipped -> delivered)", async () => {
    const ctx = newCtx();
    const { order } = await seedConfirmedOrder(ctx);
    const account = await createCourierAccount({
      organizationId: ctx.organizationId,
      provider: "mock",
      label: "Mock Courier",
      mode: "mock",
      enabled: true,
      isDefault: true,
      credentials: { v: 1, iv: "iv", tag: "tag", data: "data" },
      webhookSecret: sealSecret("secret_key_123", TEST_KEY),
      publicConfig: {},
    });

    const booked = await bookShipment(ctx, order.id, {
      courierAccountId: account.id,
      weightKg: 1.0,
    });
    expect(booked.shipment?.status).toBe("booked");
    expect(booked.status).toBe("confirmed");

    // 1. Send picked_up webhook -> order status moves to "shipped", stock committed
    const req1 = new Request(`http://localhost/api/webhooks/couriers/mock/${account.id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mock-secret": "secret_key_123",
      },
      body: JSON.stringify({
        invoice: order.orderNumber,
        consignmentId: booked.shipment?.consignmentId,
        status: "picked_up",
        at: new Date().toISOString(),
      }),
    });

    const res1 = await handleCourierWebhook("mock", account.id, req1);
    expect(res1.status).toBe(200);

    const shippedOrder = (await orderRepo.get(ctx.organizationId, order.id))!;
    expect(shippedOrder.shipment?.status).toBe("picked_up");
    expect(shippedOrder.status).toBe("shipped");
    expect(shippedOrder.stockState).toBe("committed");

    // 2. Send delivered webhook -> order status moves to "delivered", COD collected
    const req2 = new Request(`http://localhost/api/webhooks/couriers/mock/${account.id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mock-secret": "secret_key_123",
      },
      body: JSON.stringify({
        invoice: order.orderNumber,
        consignmentId: booked.shipment?.consignmentId,
        status: "delivered",
        at: new Date(Date.now() + 5000).toISOString(),
      }),
    });

    const res2 = await handleCourierWebhook("mock", account.id, req2);
    expect(res2.status).toBe(200);

    const deliveredOrder = (await orderRepo.get(ctx.organizationId, order.id))!;
    expect(deliveredOrder.shipment?.status).toBe("delivered");
    expect(deliveredOrder.status).toBe("delivered");
    expect(deliveredOrder.paymentStatus).toBe("cod_collected");
  });

  it("ignores out-of-order webhook delivery with older timestamp", async () => {
    const ctx = newCtx();
    const { order } = await seedConfirmedOrder(ctx);
    const account = await createCourierAccount({
      organizationId: ctx.organizationId,
      provider: "mock",
      label: "Mock Courier",
      mode: "mock",
      enabled: true,
      isDefault: true,
      credentials: { v: 1, iv: "iv", tag: "tag", data: "data" },
      publicConfig: {},
    });

    const booked = await bookShipment(ctx, order.id, {
      courierAccountId: account.id,
      weightKg: 1.0,
    });

    const tNewer = new Date(Date.now() + 10000);
    const tOlder = new Date(Date.now() - 10000);

    // Apply newer status first
    const reqNewer = new Request(`http://localhost/api/webhooks/couriers/mock/${account.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoice: order.orderNumber,
        consignmentId: booked.shipment?.consignmentId,
        status: "delivered",
        at: tNewer.toISOString(),
      }),
    });
    await handleCourierWebhook("mock", account.id, reqNewer);

    // Receive older status late
    const reqOlder = new Request(`http://localhost/api/webhooks/couriers/mock/${account.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoice: order.orderNumber,
        consignmentId: booked.shipment?.consignmentId,
        status: "in_transit",
        at: tOlder.toISOString(),
      }),
    });
    await handleCourierWebhook("mock", account.id, reqOlder);

    const currentOrder = (await orderRepo.get(ctx.organizationId, order.id))!;
    // Status must remain delivered, not reverted to in_transit
    expect(currentOrder.shipment?.status).toBe("delivered");
  });
});
