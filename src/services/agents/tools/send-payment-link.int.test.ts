import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminDb } from "@/lib/firebase/admin";
import { formatMoneyMinor } from "@/lib/format";
import { agentInputSchema, type Agent } from "@/schemas/agent";
import { customerInputSchema } from "@/schemas/customer";
import { shippingAddressSchema } from "@/schemas/order";
import { categoryInputSchema, productInputSchema } from "@/schemas/product";
import { createCustomer } from "@/services/crm/customers";
import { adjustStock } from "@/services/inventory/stock";
import { createDraftOrder } from "@/services/orders/drafts";
import { confirmOrder } from "@/services/orders/lifecycle";
import { createCategory } from "@/services/products/categories";
import { createProduct } from "@/services/products/products";

import { summarizeToolResult } from "../engine";
import { executeTool } from "./registry";
import type { ToolContext } from "./types";

const db = () => adminDb();
const orgs: string[] = [];
const newOrg = () => {
  const id = `org-${randomUUID()}`;
  orgs.push(id);
  return id;
};
const ORG = newOrg();
const seedCtx = { organizationId: ORG, uid: "uid-seed" };

function makeAgent(): Agent {
  return {
    ...agentInputSchema.parse({
      name: "Payment Bot",
      role: "order_management",
      tools: ["confirm_order", "send_payment_link"],
    }),
    id: "agent-pay-1",
    organizationId: ORG,
    version: 1,
    createdBy: "uid-seed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

let phoneCounter = 0;
const newPhone = () => `01718${String(1000000 + ++phoneCounter).slice(1)}`;

describe("send_payment_link tool", () => {
  let agent: Agent;
  let customerId: string;
  let phoneE164: string;
  let confirmedOnlineOrderNumber: string;
  let confirmedOnlineTotalMinor: number;
  let confirmedCodOrderNumber: string;
  let draftOrderNumber: string;

  beforeAll(async () => {
    agent = makeAgent();

    // Create a customer
    const rawPhone = newPhone();
    const cust = await createCustomer(
      seedCtx,
      customerInputSchema.parse({
        fullName: "Pay Customer",
        phone: rawPhone,
      }),
    );
    customerId = cust.id;
    phoneE164 = cust.phoneE164;

    // Create a product with stock
    const cat = await createCategory(seedCtx, categoryInputSchema.parse({ name: "Pay Cat" }));
    const prod = await createProduct(
      seedCtx,
      productInputSchema.parse({
        name: "Pay Shoes",
        sku: `sku-${randomUUID().slice(0, 8)}`,
        regularPriceMinor: 150000,
        categoryId: cat.id,
        availability: "active",
      }),
    );
    await adjustStock(seedCtx, prod.id, "default", { delta: 50, reason: "seed" });

    const addr = shippingAddressSchema.parse({
      recipientName: "Pay Customer",
      phone: rawPhone,
      line1: "House 1, Road 2",
      zone: "inside_dhaka",
    });

    // 1. Confirmed online order
    const draft1 = await createDraftOrder(seedCtx, {
      customerId,
      lines: [{ productId: prod.id, quantity: 1 }],
      shippingAddress: addr,
      paymentMethod: "online",
      discountMinor: 0,
      idempotencyKey: randomUUID(),
      source: "staff",
    });
    const conf1 = await confirmOrder(seedCtx, draft1.id);
    confirmedOnlineOrderNumber = conf1.orderNumber;
    confirmedOnlineTotalMinor = conf1.totalMinor;

    // 2. Confirmed COD order
    const draft2 = await createDraftOrder(seedCtx, {
      customerId,
      lines: [{ productId: prod.id, quantity: 1 }],
      shippingAddress: addr,
      paymentMethod: "cod",
      discountMinor: 0,
      idempotencyKey: randomUUID(),
      source: "staff",
    });
    const conf2 = await confirmOrder(seedCtx, draft2.id);
    confirmedCodOrderNumber = conf2.orderNumber;

    // 3. Unconfirmed draft order
    const draft3 = await createDraftOrder(seedCtx, {
      customerId,
      lines: [{ productId: prod.id, quantity: 1 }],
      shippingAddress: addr,
      paymentMethod: "online",
      discountMinor: 0,
      idempotencyKey: randomUUID(),
      source: "staff",
    });
    draftOrderNumber = draft3.orderNumber;
  });

  afterAll(async () => {
    for (const orgId of orgs) {
      const collections = [
        "orders",
        "orderDrafts",
        "orderEvents",
        "customers",
        "products",
        "categories",
        "inventoryItems",
        "paymentLinks",
      ];
      for (const coll of collections) {
        const snap = await db().collection(`organizations/${orgId}/${coll}`).get();
        const batch = db().batch();
        for (const doc of snap.docs) batch.delete(doc.ref);
        await batch.commit();
      }
    }
  });

  const call = (ctx: ToolContext, args: unknown) =>
    executeTool(ctx, "send_payment_link", JSON.stringify(args));

  it("simulates link generation on test channel (dry-run)", async () => {
    const ctx: ToolContext = {
      organizationId: ORG,
      agent,
      sessionId: "sess-test",
      channel: "test",
      actorUid: "uid-seed",
    };

    const out = await call(ctx, {
      orderNumber: "SP-999999",
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.dryRunAction).toEqual({
      kind: "send_payment_link",
      fields: { orderNumber: "SP-999999" },
    });
    expect((out.data as { url: string }).url).toContain("simulated_token");
  });

  it("fails if customer identity is not known on live channel", async () => {
    const ctx: ToolContext = {
      organizationId: ORG,
      agent,
      sessionId: "sess-live-no-cust",
      channel: "whatsapp",
      actorUid: "uid-seed",
      // No contactPhoneE164
    };

    const out = await call(ctx, {
      orderNumber: confirmedOnlineOrderNumber,
    });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("denied");
  });

  it("fails if order does not exist or belongs to another customer", async () => {
    const ctx: ToolContext = {
      organizationId: ORG,
      agent,
      sessionId: "sess-live",
      channel: "whatsapp",
      actorUid: "uid-seed",
      contactPhoneE164: phoneE164,
    };

    const out = await call(ctx, {
      orderNumber: "SP-NONEXISTENT",
    });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("not_found");
  });

  it("fails if order payment method is COD", async () => {
    const ctx: ToolContext = {
      organizationId: ORG,
      agent,
      sessionId: "sess-live",
      channel: "whatsapp",
      actorUid: "uid-seed",
      contactPhoneE164: phoneE164,
    };

    const out = await call(ctx, {
      orderNumber: confirmedCodOrderNumber,
    });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("invalid");
    expect(out.message).toContain("Cash on Delivery");
  });

  it("fails if order is in draft status", async () => {
    const ctx: ToolContext = {
      organizationId: ORG,
      agent,
      sessionId: "sess-live",
      channel: "whatsapp",
      actorUid: "uid-seed",
      contactPhoneE164: phoneE164,
    };

    const out = await call(ctx, {
      orderNumber: draftOrderNumber,
    });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("invalid");
    expect(out.message).toContain("status");
  });

  it("generates a live payment link for confirmed online order", async () => {
    const ctx: ToolContext = {
      organizationId: ORG,
      agent,
      sessionId: "sess-live",
      channel: "whatsapp",
      actorUid: "uid-seed",
      contactPhoneE164: phoneE164,
    };

    const out = await call(ctx, {
      orderNumber: confirmedOnlineOrderNumber,
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const data = out.data as { orderNumber: string; url: string; totalText: string; expiresAt: string };
    expect(data.orderNumber).toBe(confirmedOnlineOrderNumber);
    expect(data.url).toMatch(/^http:\/\/localhost:3000\/pay\//);
    expect(data.totalText).toBe(formatMoneyMinor(confirmedOnlineTotalMinor));
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("summarizes the result cleanly for the engine", () => {
    const text = summarizeToolResult("send_payment_link", {
      ok: true,
      data: {
        orderNumber: "SP-000001",
        url: "http://localhost:3000/pay/abc",
      },
    });
    expect(text).toContain("SP-000001");
    expect(text).toContain("http://localhost:3000/pay/abc");
  });
});
