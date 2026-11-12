import { describe, expect, it } from "vitest";

import { adminDb } from "@/lib/firebase/admin";
import { createGatewayAccount } from "@/repositories/integrations";
import { orderRepo } from "@/repositories/orders";
import { getPaymentAttempt } from "@/repositories/payments";
import type { Order } from "@/schemas/order";

import { createPaymentSession } from "./attempts";
import { createPaymentLink, resolvePaymentLink } from "./links";

function seedConfirmedOnlineOrder(orgId: string, orderId: string, totalMinor = 15000): Order {
  const now = new Date().toISOString();
  return {
    id: orderId,
    organizationId: orgId,
    orderNumber: `SP-${orderId.slice(-6)}`,
    customerId: "cust_1",
    customerSnapshot: {
      name: "Habib",
      phoneE164: "+8801700000000",
    },
    shippingAddress: {
      recipientName: "Habib",
      phone: "01700000000",
      phoneE164: "+8801700000000",
      line1: "123 Main St",
      zone: "inside_dhaka",
    },
    lines: [
      {
        productId: "prod_1",
        variantId: "default",
        productName: "Shirt",
        variantLabel: null,
        sku: "SHIRT-1",
        quantity: 1,
        unitPriceMinor: totalMinor - 6000,
        lineTotalMinor: totalMinor - 6000,
        holdKey: "hk_1",
        holdState: "held",
      },
    ],
    pendingLines: null,
    releasingLines: null,
    hasReleasingLines: false,
    subtotalMinor: totalMinor - 6000,
    deliveryChargeMinor: 6000,
    discountMinor: 0,
    totalMinor,
    currency: "BDT",
    paymentMethod: "online",
    status: "confirmed",
    paymentStatus: "awaiting_payment",
    stockState: "held",
    holdExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    source: "staff",
    createdBy: { kind: "user", uid: "staff_1" },
    revision: 1,
    stockAlert: null,
    conversationId: null,
    notes: null,
    idempotencyKey: "idem_1",
    confirmedAt: now,
    cancelledAt: null,
    cancelReason: null,
    refund: null,
    allowUnpaidReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("payment links and checkout flow", () => {
  it("creates, resolves, and initiates a payment session with mock gateway", async () => {
    const orgId = "org_pay_flow_1";
    const orderId = "order_test_pay_1";
    const db = adminDb();

    // 1. Seed org
    await db.collection("organizations").doc(orgId).set({ name: "Habib's Store" });

    // 2. Seed confirmed online order
    const order = seedConfirmedOnlineOrder(orgId, orderId);
    await orderRepo.create(orgId, order, orderId);

    // 3. Seed mock gateway account
    const gwAccount = await createGatewayAccount({
      organizationId: orgId,
      provider: "mock",
      label: "Mock Pay",
      mode: "mock",
      enabled: true,
      isDefault: true,
      credentials: { v: 1, iv: "iv", tag: "tag", data: "data" },
      publicConfig: {},
    });

    // 4. Create payment link
    const linkRes = await createPaymentLink(orgId, orderId, "https://app.example.com");
    expect(linkRes.token).toBeTypeOf("string");
    expect(linkRes.url).toBe(`https://app.example.com/pay/${linkRes.token}`);

    // 5. Resolve payment link for checkout page
    const publicView = await resolvePaymentLink(linkRes.token);
    expect(publicView.orderNumber).toBe(order.orderNumber);
    expect(publicView.organizationName).toBe("Habib's Store");
    expect(publicView.totalMinor).toBe(15000);
    expect(publicView.status).toBe("awaiting_payment");
    expect(publicView.availableGateways.length).toBeGreaterThanOrEqual(1);

    // 6. Create payment session
    const sessionRes = await createPaymentSession(
      linkRes.token,
      gwAccount.id,
      "https://app.example.com",
    );
    expect(sessionRes.redirectUrl).toContain("mock-checkout");
    expect(sessionRes.tranId).toBeTypeOf("string");

    // 7. Verify payment attempt record in Firestore
    const attempt = await getPaymentAttempt(sessionRes.tranId);
    expect(attempt).not.toBeNull();
    expect(attempt?.state).toBe("redirected");
    expect(attempt?.expectedAmountMinor).toBe(15000);
    expect(attempt?.gatewayAccountId).toBe(gwAccount.id);
  });
});
