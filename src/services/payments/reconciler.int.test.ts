import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { createGatewayAccount } from "@/repositories/integrations";
import { orderRepo } from "@/repositories/orders";
import { createPaymentAttempt, getPaymentAttempt } from "@/repositories/payments";
import type { Order } from "@/schemas/order";

import { setMockOutcome } from "./gateways/mock";
import { reconcilePaymentAttempts } from "./reconciler";

function seedConfirmedOnlineOrder(orgId: string, orderId: string, totalMinor = 15000): Order {
  const now = new Date().toISOString();
  return {
    id: orderId,
    organizationId: orgId,
    orderNumber: `SP-${orderId.slice(-6)}`,
    customerId: "cust_1",
    customerSnapshot: {
      name: "Tarek",
      phoneE164: "+8801700000000",
    },
    shippingAddress: {
      recipientName: "Tarek",
      phone: "01700000000",
      phoneE164: "+8801700000000",
      line1: "789 Road",
      zone: "inside_dhaka",
    },
    lines: [
      {
        productId: "prod_1",
        variantId: "default",
        productName: "Watch",
        variantLabel: null,
        sku: "WATCH-1",
        quantity: 1,
        unitPriceMinor: totalMinor - 6000,
        lineTotalMinor: totalMinor - 6000,
        holdKey: "hk_w1",
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

describe("reconcilePaymentAttempts", () => {
  it("reconciles attempts between 15m and 48h old, and expires attempts older than 48h", async () => {
    const orgId = "org_rec_1";
    const orderId1 = "ord_rec_1";
    const orderId2 = "ord_rec_2";

    await orderRepo.create(orgId, seedConfirmedOnlineOrder(orgId, orderId1), orderId1);
    await orderRepo.create(orgId, seedConfirmedOnlineOrder(orgId, orderId2), orderId2);

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

    const now = Date.now();
    const twentyMinsAgo = Timestamp.fromDate(new Date(now - 20 * 60 * 1000));
    const fiftyHoursAgo = Timestamp.fromDate(new Date(now - 50 * 60 * 60 * 1000));

    // 1. Attempt eligible for reconciliation (20 mins old)
    const tran1 = "TR_REC_20MIN";
    await createPaymentAttempt({
      tranId: tran1,
      organizationId: orgId,
      orderId: orderId1,
      gatewayAccountId: account.id,
      gateway: "mock",
      expectedAmountMinor: 15000,
      currency: "BDT",
      state: "redirected",
      createdAt: twentyMinsAgo,
      updatedAt: twentyMinsAgo,
    });
    setMockOutcome(tran1, "paid");

    // 2. Attempt eligible for timeout expiration (50 hours old)
    const tran2 = "TR_REC_50HR";
    await createPaymentAttempt({
      tranId: tran2,
      organizationId: orgId,
      orderId: orderId2,
      gatewayAccountId: account.id,
      gateway: "mock",
      expectedAmountMinor: 15000,
      currency: "BDT",
      state: "redirected",
      createdAt: fiftyHoursAgo,
      updatedAt: fiftyHoursAgo,
    });

    const res = await reconcilePaymentAttempts(50, 10000);
    expect(res.checked).toBeGreaterThanOrEqual(2);
    expect(res.reconciled).toBeGreaterThanOrEqual(1);
    expect(res.expired).toBeGreaterThanOrEqual(1);

    const attempt1 = await getPaymentAttempt(tran1);
    expect(attempt1?.state).toBe("paid");

    const attempt2 = await getPaymentAttempt(tran2);
    expect(attempt2?.state).toBe("expired");
  });
});
