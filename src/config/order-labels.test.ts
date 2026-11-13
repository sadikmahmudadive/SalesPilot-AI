import { describe, expect, it } from "vitest";

import { ORDER_STATUSES, PAYMENT_STATUSES } from "@/schemas/order";

import {
  ACTION_LABELS,
  ORDER_ACTIONS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_VARIANTS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_VARIANTS,
  isHoldExpired,
} from "./order-labels";

const draftPast = (holdExpiresAt: string | null) =>
  ({ status: "draft", paymentStatus: "cod_pending", holdExpiresAt }) as const;

describe("order labels", () => {
  it("labels every order status", () => {
    expect(Object.keys(ORDER_STATUS_LABELS).sort()).toEqual([...ORDER_STATUSES].sort());
    expect(ORDER_STATUS_LABELS).toMatchObject({
      draft: "Draft",
      confirmed: "Confirmed",
      processing: "Processing",
      shipped: "Shipped",
      delivered: "Delivered",
      cancelled: "Cancelled",
      returned: "Returned",
    });
    expect(Object.keys(ORDER_STATUS_VARIANTS).sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it("labels every payment status", () => {
    expect(Object.keys(PAYMENT_STATUS_LABELS).sort()).toEqual([...PAYMENT_STATUSES].sort());
    expect(PAYMENT_STATUS_LABELS).toMatchObject({
      cod_pending: "COD pending",
      cod_collected: "COD collected",
      awaiting_payment: "Awaiting payment",
      paid: "Paid",
      failed: "Payment failed",
      refunded: "Refunded",
    });
    expect(Object.keys(PAYMENT_STATUS_VARIANTS).sort()).toEqual([...PAYMENT_STATUSES].sort());
  });

  it("labels every action", () => {
    expect(Object.keys(ACTION_LABELS).sort()).toEqual([...ORDER_ACTIONS].sort());
    expect(ACTION_LABELS).toEqual({
      confirm: "Confirm",
      process: "Start processing",
      ship: "Mark shipped",
      deliver: "Mark delivered",
      return: "Mark returned",
      cancel: "Cancel",
      expire: "Expire",
      refund: "Record refund",
    });
  });
});

describe("isHoldExpired", () => {
  const now = Date.parse("2026-11-11T12:00:00.000Z");
  const past = "2026-11-11T11:59:59.000Z";
  const future = "2026-11-11T12:30:00.000Z";

  it("is true for a draft or an unpaid online order whose hold is in the past", () => {
    expect(isHoldExpired(draftPast(past), now)).toBe(true);
    expect(
      isHoldExpired(
        { status: "confirmed", paymentStatus: "awaiting_payment", holdExpiresAt: past },
        now,
      ),
    ).toBe(true);
    expect(
      isHoldExpired({ status: "confirmed", paymentStatus: "failed", holdExpiresAt: past }, now),
    ).toBe(true);
  });

  it("treats a hold ending exactly now as expired", () => {
    expect(isHoldExpired(draftPast(new Date(now).toISOString()), now)).toBe(true);
  });

  it("is false while the hold is still running or absent", () => {
    expect(isHoldExpired(draftPast(future), now)).toBe(false);
    expect(isHoldExpired(draftPast(null), now)).toBe(false);
  });

  it("is false for orders that do not hold stock on a timer", () => {
    for (const [status, paymentStatus] of [
      ["confirmed", "cod_pending"],
      ["confirmed", "paid"],
      ["shipped", "cod_pending"],
      ["cancelled", "awaiting_payment"],
    ] as const) {
      expect(isHoldExpired({ status, paymentStatus, holdExpiresAt: past }, now)).toBe(false);
    }
  });

  it("is false for an unparseable date", () => {
    expect(isHoldExpired(draftPast("nope"), now)).toBe(false);
  });
});
