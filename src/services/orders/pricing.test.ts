import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import { DEFAULT_ORDER_SETTINGS } from "@/schemas/order";

import { deliveryChargeFor, priceOrder } from "./pricing";

const settings = DEFAULT_ORDER_SETTINGS;
const lines = [
  { unitPriceMinor: 1500, quantity: 2 },
  { unitPriceMinor: 999, quantity: 1 },
];

function pathOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    return (e as ValidationError).details?.[0]?.path;
  }
  throw new Error("expected ValidationError");
}

describe("priceOrder", () => {
  it("prices inside Dhaka", () => {
    expect(priceOrder({ lines, discountMinor: 0, zone: "inside_dhaka", settings })).toEqual({
      subtotalMinor: 3999,
      discountMinor: 0,
      deliveryChargeMinor: 6000,
      totalMinor: 9999,
    });
  });

  it("uses the outside Dhaka charge", () => {
    const out = priceOrder({ lines, discountMinor: 0, zone: "outside_dhaka", settings });
    expect(out.deliveryChargeMinor).toBe(12000);
    expect(out.totalMinor).toBe(15999);
  });

  it("subtracts the discount", () => {
    const out = priceOrder({ lines, discountMinor: 999, zone: "inside_dhaka", settings });
    expect(out.totalMinor).toBe(9000);
  });

  it("allows a discount equal to the subtotal", () => {
    const out = priceOrder({ lines, discountMinor: 3999, zone: "inside_dhaka", settings });
    expect(out.totalMinor).toBe(6000);
  });

  it("rejects discount above subtotal", () => {
    expect(
      pathOf(() => priceOrder({ lines, discountMinor: 4000, zone: "inside_dhaka", settings })),
    ).toBe("discountMinor");
  });

  it("stays exact at the maximum line size", () => {
    const big = Array.from({ length: 20 }, () => ({ unitPriceMinor: 1e9, quantity: 1000 }));
    const out = priceOrder({ lines: big, discountMinor: 0, zone: "inside_dhaka", settings });
    expect(Number.isSafeInteger(out.totalMinor)).toBe(true);
    expect(out.subtotalMinor).toBe(20 * 1e12);
    expect(out.totalMinor).toBe(20 * 1e12 + 6000);
  });

  it("rejects non-integer and negative input with the field path", () => {
    expect(
      pathOf(() =>
        priceOrder({
          lines: [{ unitPriceMinor: 10.5, quantity: 1 }],
          discountMinor: 0,
          zone: "inside_dhaka",
          settings,
        }),
      ),
    ).toBe("lines.0.unitPriceMinor");
    expect(
      pathOf(() =>
        priceOrder({
          lines: [lines[0]!, { unitPriceMinor: 10, quantity: 0 }],
          discountMinor: 0,
          zone: "inside_dhaka",
          settings,
        }),
      ),
    ).toBe("lines.1.quantity");
    expect(
      pathOf(() => priceOrder({ lines, discountMinor: 1.5, zone: "inside_dhaka", settings })),
    ).toBe("discountMinor");
    expect(
      pathOf(() => priceOrder({ lines, discountMinor: -1, zone: "inside_dhaka", settings })),
    ).toBe("discountMinor");
  });

  it("rejects an empty or oversized line list", () => {
    expect(
      pathOf(() => priceOrder({ lines: [], discountMinor: 0, zone: "inside_dhaka", settings })),
    ).toBe("lines");
    expect(
      pathOf(() =>
        priceOrder({
          lines: Array(21).fill(lines[0]),
          discountMinor: 0,
          zone: "inside_dhaka",
          settings,
        }),
      ),
    ).toBe("lines");
  });
});

describe("deliveryChargeFor", () => {
  it("picks the zone charge from settings", () => {
    const custom = { ...settings, deliveryChargeInsideDhakaMinor: 5000 };
    expect(deliveryChargeFor("inside_dhaka", custom)).toBe(5000);
    expect(deliveryChargeFor("outside_dhaka", custom)).toBe(12000);
  });
});
