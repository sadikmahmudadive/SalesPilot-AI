import { describe, expect, it } from "vitest";

import {
  PAYMENT_ATTEMPT_STATES,
  paymentAttemptSchema,
  paymentLinkSchema,
  publicPaymentViewSchema,
  webhookEventSchema,
} from "./payment";

describe("payment schemas", () => {
  it("validates paymentAttemptSchema", () => {
    const attempt = {
      tranId: "tran_base32_xyz123",
      organizationId: "org_1",
      orderId: "ord_1",
      gatewayAccountId: "gw_1",
      gateway: "sslcommerz" as const,
      expectedAmountMinor: 15000,
      currency: "BDT" as const,
      state: "created" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const parsed = paymentAttemptSchema.parse(attempt);
    expect(parsed.tranId).toBe("tran_base32_xyz123");
    expect(parsed.expectedAmountMinor).toBe(15000);
    expect(parsed.currency).toBe("BDT");
  });

  it("rejects non-BDT currency or negative amount in paymentAttemptSchema", () => {
    expect(() =>
      paymentAttemptSchema.parse({
        tranId: "tran_1",
        organizationId: "org_1",
        orderId: "ord_1",
        gatewayAccountId: "gw_1",
        gateway: "sslcommerz",
        expectedAmountMinor: -10,
        currency: "USD",
        state: "created",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toThrow();
  });

  it("validates paymentLinkSchema", () => {
    const link = {
      tokenHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      organizationId: "org_1",
      orderId: "ord_1",
      expiresAt: new Date(),
      createdAt: new Date(),
    };

    const parsed = paymentLinkSchema.parse(link);
    expect(parsed.orderId).toBe("ord_1");
  });

  it("validates webhookEventSchema", () => {
    const event = {
      id: "sslcommerz_evt_123",
      provider: "sslcommerz",
      eventKey: "evt_123",
      receivedAt: new Date(),
    };

    const parsed = webhookEventSchema.parse(event);
    expect(parsed.id).toBe("sslcommerz_evt_123");
  });

  it("validates publicPaymentViewSchema", () => {
    const view = {
      orderNumber: "SP-000001",
      organizationName: "Fashion Hub",
      lines: [
        {
          name: "Cotton Shirt",
          variantName: "Blue / L",
          quantity: 2,
          unitPriceMinor: 120000,
          totalMinor: 240000,
        },
      ],
      deliveryChargeMinor: 6000,
      discountMinor: 0,
      totalMinor: 246000,
      currency: "BDT" as const,
      status: "awaiting_payment" as const,
      availableGateways: [
        {
          id: "gw_1",
          provider: "sslcommerz" as const,
          label: "Card / Mobile Banking",
          isDefault: true,
        },
      ],
      expiresAt: new Date().toISOString(),
    };

    const parsed = publicPaymentViewSchema.parse(view);
    expect(parsed.orderNumber).toBe("SP-000001");
    expect(parsed.totalMinor).toBe(246000);
  });

  it("exports all PAYMENT_ATTEMPT_STATES", () => {
    expect(PAYMENT_ATTEMPT_STATES).toEqual([
      "created",
      "redirected",
      "paid",
      "failed",
      "cancelled",
      "expired",
    ]);
  });
});
