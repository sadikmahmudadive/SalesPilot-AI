import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { createGatewayAccount } from "@/repositories/integrations";
import { orderRepo } from "@/repositories/orders";
import { createPaymentAttempt, getPaymentAttempt } from "@/repositories/payments";
import type { Order } from "@/schemas/order";

import { confirmPaymentAttempt } from "./callbacks";
import { setMockOutcome } from "./gateways/mock";

function seedConfirmedOnlineOrder(orgId: string, orderId: string, totalMinor = 15000): Order {
  const now = new Date().toISOString();
  return {
    id: orderId,
    organizationId: orgId,
    orderNumber: `SP-${orderId.slice(-6)}`,
    customerId: "cust_1",
    customerSnapshot: {
      name: "Sultana",
      phoneE164: "+8801800000000",
    },
    shippingAddress: {
      recipientName: "Sultana",
      phone: "01800000000",
      phoneE164: "+8801800000000",
      line1: "456 Park Rd",
      zone: "inside_dhaka",
    },
    lines: [
      {
        productId: "prod_1",
        variantId: "default",
        productName: "Dress",
        variantLabel: null,
        sku: "DRESS-1",
        quantity: 1,
        unitPriceMinor: totalMinor - 6000,
        lineTotalMinor: totalMinor - 6000,
        holdKey: "hk_d1",
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
    confirmedAt: now,
    cancelledAt: null,
    cancelReason: null,
    refund: null,
    allowUnpaidReason: null,
    source: "staff",
    createdBy: { kind: "user", uid: "staff_1" },
    revision: 1,
    stockAlert: null,
    conversationId: null,
    notes: null,
    idempotencyKey: `idem_${orderId}`,
    createdAt: now,
    updatedAt: now,
  };
}

describe("confirmPaymentAttempt", () => {
  it("marks attempt paid and transitions order paymentStatus to paid", async () => {
    const orgId = "org_cb_1";
    const orderId = "ord_cb_1";
    const tranId = "TR_CB_100";

    const order = seedConfirmedOnlineOrder(orgId, orderId, 25000);
    await orderRepo.create(orgId, order, orderId);

    const account = await createGatewayAccount({
      organizationId: orgId,
      provider: "mock",
      label: "Mock Pay",
      mode: "mock",
      enabled: true,
      isDefault: true,
      credentials: { v: 1, iv: "iv", tag: "tag", data: "data" },
      publicConfig: {},
    });

    const now = Timestamp.now();
    await createPaymentAttempt({
      tranId,
      organizationId: orgId,
      orderId,
      gatewayAccountId: account.id,
      gateway: "mock",
      expectedAmountMinor: 25000,
      currency: "BDT",
      state: "redirected",
      createdAt: now,
      updatedAt: now,
    });

    // Simulate gateway confirming payment
    setMockOutcome(tranId, "paid");

    const result = await confirmPaymentAttempt(tranId);
    expect(result.outcome).toBe("paid");

    // Verify attempt state
    const updatedAttempt = await getPaymentAttempt(tranId);
    expect(updatedAttempt?.state).toBe("paid");

    // Verify order state
    const updatedOrder = await orderRepo.get(orgId, orderId);
    expect(updatedOrder?.paymentStatus).toBe("paid");
    expect(updatedOrder?.holdExpiresAt).toBeNull();
  });

  it("handles duplicate verification idempotently without re-processing", async () => {
    const orgId = "org_cb_2";
    const orderId = "ord_cb_2";
    const tranId = "TR_CB_200";

    const order = seedConfirmedOnlineOrder(orgId, orderId, 18000);
    await orderRepo.create(orgId, order, orderId);

    const account = await createGatewayAccount({
      organizationId: orgId,
      provider: "mock",
      label: "Mock Pay",
      mode: "mock",
      enabled: true,
      isDefault: true,
      credentials: { v: 1, iv: "iv", tag: "tag", data: "data" },
      publicConfig: {},
    });

    const now = Timestamp.now();
    await createPaymentAttempt({
      tranId,
      organizationId: orgId,
      orderId,
      gatewayAccountId: account.id,
      gateway: "mock",
      expectedAmountMinor: 18000,
      currency: "BDT",
      state: "redirected",
      createdAt: now,
      updatedAt: now,
    });

    setMockOutcome(tranId, "paid");

    const res1 = await confirmPaymentAttempt(tranId);
    const res2 = await confirmPaymentAttempt(tranId);

    expect(res1.outcome).toBe("paid");
    expect(res2.outcome).toBe("paid");
  });
});
