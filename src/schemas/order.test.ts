import { describe, expect, it } from "vitest";

import {
  DEFAULT_ORDER_SETTINGS,
  MAX_LINE_QUANTITY,
  MAX_ORDER_LINES,
  orderCreateSchema,
  orderDraftPatchSchema,
  orderListQuerySchema,
  orderSettingsSchema,
  processSchema,
  reasonSchema,
  shippingAddressSchema,
} from "./order";

const address = {
  recipientName: "Rahim Uddin",
  phone: "01712345678",
  line1: "House 1, Road 2",
  zone: "inside_dhaka",
};
const line = { productId: "prod1", quantity: 1 };
const base = {
  customerId: "cust1",
  lines: [line],
  shippingAddress: address,
  paymentMethod: "cod",
  idempotencyKey: "key-12345678",
};

describe("orderCreateSchema", () => {
  it("accepts a minimal order and applies defaults", () => {
    const out = orderCreateSchema.parse(base);
    expect(out.discountMinor).toBe(0);
    expect(out.confirm).toBe(false);
    expect(out.shippingAddress.phoneE164).toBe("+8801712345678");
  });

  it("exports the line limits", () => {
    expect(MAX_ORDER_LINES).toBe(20);
    expect(MAX_LINE_QUANTITY).toBe(1000);
  });

  it("rejects 21 lines and an empty line list", () => {
    expect(orderCreateSchema.safeParse({ ...base, lines: Array(21).fill(line) }).success).toBe(
      false,
    );
    expect(orderCreateSchema.safeParse({ ...base, lines: Array(20).fill(line) }).success).toBe(
      true,
    );
    expect(orderCreateSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
  });

  it("rejects quantity 0, 1001 and fractions", () => {
    for (const quantity of [0, 1001, 1.5]) {
      expect(orderCreateSchema.safeParse({ ...base, lines: [{ ...line, quantity }] }).success).toBe(
        false,
      );
    }
    expect(
      orderCreateSchema.safeParse({ ...base, lines: [{ ...line, quantity: 1000 }] }).success,
    ).toBe(true);
  });

  it("rejects bad ids", () => {
    expect(orderCreateSchema.safeParse({ ...base, customerId: "a/b" }).success).toBe(false);
    expect(
      orderCreateSchema.safeParse({ ...base, lines: [{ ...line, productId: "" }] }).success,
    ).toBe(false);
    expect(
      orderCreateSchema.safeParse({ ...base, lines: [{ ...line, variantId: "x/y" }] }).success,
    ).toBe(false);
  });

  it("rejects a bad idempotency key", () => {
    expect(orderCreateSchema.safeParse({ ...base, idempotencyKey: "short" }).success).toBe(false);
    expect(
      orderCreateSchema.safeParse({ ...base, idempotencyKey: "has space 1234" }).success,
    ).toBe(false);
  });

  it("rejects out-of-range discounts and unknown enums", () => {
    expect(orderCreateSchema.safeParse({ ...base, discountMinor: -1 }).success).toBe(false);
    expect(orderCreateSchema.safeParse({ ...base, discountMinor: 1e9 + 1 }).success).toBe(false);
    expect(orderCreateSchema.safeParse({ ...base, paymentMethod: "cheque" }).success).toBe(false);
  });
});

describe("shippingAddressSchema", () => {
  it("derives phoneE164 and trims the name", () => {
    const out = shippingAddressSchema.parse({ ...address, recipientName: "  Rahim  " });
    expect(out.phoneE164).toBe("+8801712345678");
    expect(out.recipientName).toBe("Rahim");
  });

  it("ignores a client-supplied phoneE164", () => {
    const out = shippingAddressSchema.parse({ ...address, phoneE164: "+15550000000" });
    expect(out.phoneE164).toBe("+8801712345678");
  });

  it("rejects an invalid phone, blank name and unknown zone", () => {
    expect(shippingAddressSchema.safeParse({ ...address, phone: "123" }).success).toBe(false);
    expect(shippingAddressSchema.safeParse({ ...address, recipientName: "   " }).success).toBe(
      false,
    );
    expect(shippingAddressSchema.safeParse({ ...address, zone: "mars" }).success).toBe(false);
  });
});

describe("orderDraftPatchSchema", () => {
  it("rejects an empty patch", () => {
    expect(orderDraftPatchSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a single field without applying defaults", () => {
    expect(orderDraftPatchSchema.parse({ discountMinor: 5 })).toEqual({ discountMinor: 5 });
    expect(orderDraftPatchSchema.parse({ notes: "hi" })).toEqual({ notes: "hi" });
  });
});

describe("small schemas", () => {
  it("reasonSchema trims and bounds", () => {
    expect(reasonSchema.parse({ reason: "  out of stock " })).toEqual({ reason: "out of stock" });
    expect(reasonSchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(reasonSchema.safeParse({ reason: "x".repeat(301) }).success).toBe(false);
  });

  it("processSchema allows an optional reason", () => {
    expect(processSchema.parse({})).toEqual({});
    expect(processSchema.parse({ allowUnpaidReason: "trusted" })).toEqual({
      allowUnpaidReason: "trusted",
    });
  });

  it("orderSettingsSchema enforces ranges", () => {
    expect(orderSettingsSchema.parse(DEFAULT_ORDER_SETTINGS)).toEqual(DEFAULT_ORDER_SETTINGS);
    expect(
      orderSettingsSchema.safeParse({ ...DEFAULT_ORDER_SETTINGS, draftHoldMinutes: 4 }).success,
    ).toBe(false);
    expect(
      orderSettingsSchema.safeParse({ ...DEFAULT_ORDER_SETTINGS, paymentHoldHours: 169 }).success,
    ).toBe(false);
    expect(
      orderSettingsSchema.safeParse({
        ...DEFAULT_ORDER_SETTINGS,
        deliveryChargeInsideDhakaMinor: 1_000_001,
      }).success,
    ).toBe(false);
  });

  it("DEFAULT_ORDER_SETTINGS holds the documented defaults", () => {
    expect(DEFAULT_ORDER_SETTINGS).toEqual({
      deliveryChargeInsideDhakaMinor: 6000,
      deliveryChargeOutsideDhakaMinor: 12000,
      draftHoldMinutes: 30,
      paymentHoldHours: 24,
    });
  });
});

describe("orderListQuerySchema", () => {
  it("defaults the limit and coerces from strings", () => {
    expect(orderListQuerySchema.parse({}).limit).toBe(25);
    expect(orderListQuerySchema.parse({ limit: "50" }).limit).toBe(50);
  });

  it("rejects bad limits, statuses and dates", () => {
    expect(orderListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(orderListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(orderListQuerySchema.safeParse({ status: "nope" }).success).toBe(false);
    expect(orderListQuerySchema.safeParse({ from: "yesterday" }).success).toBe(false);
    expect(
      orderListQuerySchema.safeParse({ status: "draft", from: "2026-01-01T00:00:00.000Z" })
        .success,
    ).toBe(true);
  });
});
