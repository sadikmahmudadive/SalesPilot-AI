import { describe, expect, it } from "vitest";

import {
  buildDraftPatch,
  EMPTY_ORDER_VALUES,
  mapOrderApiError,
  newIdempotencyKey,
  orderToFormValues,
  previewTotals,
  toCreateBody,
  validateOrderForm,
  type OrderFormValues,
} from "@/components/orders/order-form-model";
import { ApiError } from "@/lib/api/client";
import { DEFAULT_ORDER_SETTINGS, type Order } from "@/schemas/order";
import { priceOrder } from "@/services/orders/pricing";

const KEY = "0123456789abcdef";

const valid: OrderFormValues = {
  customerId: "cust1",
  lines: [{ productId: "p1", variantId: "", quantity: "2" }],
  address: {
    recipientName: "  Rahim Uddin ",
    phone: "01712345678",
    line1: " House 4, Road 2 ",
    area: "",
    district: "  ",
    zone: "inside_dhaka",
    note: "",
  },
  paymentMethod: "cod",
  discount: "",
  notes: "",
};

const withDiscount = (discount: string): OrderFormValues => ({ ...valid, discount });

describe("toCreateBody", () => {
  it("converts a taka discount to paisa without float error", () => {
    expect(toCreateBody(withDiscount("150.50"), KEY, false).discountMinor).toBe(15050);
    expect(toCreateBody(withDiscount("19.99"), KEY, false).discountMinor).toBe(1999);
    expect(toCreateBody(withDiscount("1,200"), KEY, false).discountMinor).toBe(120000);
  });

  it("treats a blank discount as zero", () => {
    expect(toCreateBody(withDiscount("  "), KEY, false).discountMinor).toBe(0);
  });

  it("drops blank optional address fields, blank notes and blank variants", () => {
    const body = toCreateBody(valid, KEY, false);
    expect(body.shippingAddress).toEqual({
      recipientName: "Rahim Uddin",
      phone: "01712345678",
      line1: "House 4, Road 2",
      zone: "inside_dhaka",
    });
    expect(body).not.toHaveProperty("notes");
    expect(body.lines).toEqual([{ productId: "p1", quantity: 2 }]);
  });

  it("keeps filled optional fields and the variant", () => {
    const body = toCreateBody(
      {
        ...valid,
        lines: [{ productId: "p1", variantId: "xl-red", quantity: "3" }],
        address: { ...valid.address, area: "Mirpur", district: "Dhaka", note: "Call first" },
        notes: " Gift wrap ",
      },
      KEY,
      true,
    );
    expect(body.lines).toEqual([{ productId: "p1", variantId: "xl-red", quantity: 3 }]);
    expect(body.shippingAddress).toMatchObject({
      area: "Mirpur",
      district: "Dhaka",
      note: "Call first",
    });
    expect(body.notes).toBe("Gift wrap");
  });

  it("passes the idempotency key, the confirm flag, the customer and the payment method", () => {
    const body = toCreateBody({ ...valid, paymentMethod: "online" }, KEY, true);
    expect(body).toMatchObject({
      idempotencyKey: KEY,
      confirm: true,
      customerId: "cust1",
      paymentMethod: "online",
    });
    expect(toCreateBody(valid, KEY, false).confirm).toBe(false);
  });
});

describe("newIdempotencyKey", () => {
  it("is 32 characters without dashes and differs per call", () => {
    const a = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(newIdempotencyKey()).not.toBe(a);
  });
});

describe("previewTotals", () => {
  const prices = new Map([["p1", 25000]]);

  it("is null while there are no lines", () => {
    expect(previewTotals({ ...valid, lines: [] }, prices, DEFAULT_ORDER_SETTINGS)).toBeNull();
  });

  it("is null while a line has no product or no known price", () => {
    expect(previewTotals(valid, new Map(), DEFAULT_ORDER_SETTINGS)).toBeNull();
    expect(
      previewTotals(
        { ...valid, lines: [{ productId: "", variantId: "", quantity: "1" }] },
        prices,
        DEFAULT_ORDER_SETTINGS,
      ),
    ).toBeNull();
    expect(
      previewTotals(
        {
          ...valid,
          lines: [
            { productId: "p1", variantId: "", quantity: "1" },
            { productId: "p2", variantId: "", quantity: "1" },
          ],
        },
        prices,
        DEFAULT_ORDER_SETTINGS,
      ),
    ).toBeNull();
  });

  it("is null for an unusable quantity, discount or zone instead of throwing", () => {
    const line = (quantity: string) => ({ ...valid, lines: [{ ...valid.lines[0]!, quantity }] });
    expect(previewTotals(line("0"), prices, DEFAULT_ORDER_SETTINGS)).toBeNull();
    expect(previewTotals(line("1.5"), prices, DEFAULT_ORDER_SETTINGS)).toBeNull();
    expect(previewTotals(line(""), prices, DEFAULT_ORDER_SETTINGS)).toBeNull();
    expect(previewTotals(withDiscount("abc"), prices, DEFAULT_ORDER_SETTINGS)).toBeNull();
    expect(previewTotals(withDiscount("9999"), prices, DEFAULT_ORDER_SETTINGS)).toBeNull();
    expect(
      previewTotals(
        { ...valid, address: { ...valid.address, zone: "" } },
        prices,
        DEFAULT_ORDER_SETTINGS,
      ),
    ).toBeNull();
  });

  it("matches priceOrder when everything is priced", () => {
    const values = withDiscount("100");
    expect(previewTotals(values, prices, DEFAULT_ORDER_SETTINGS)).toEqual(
      priceOrder({
        lines: [{ unitPriceMinor: 25000, quantity: 2 }],
        discountMinor: 10000,
        zone: "inside_dhaka",
        settings: DEFAULT_ORDER_SETTINGS,
      }),
    );
  });

  it("uses the outside-Dhaka charge for that zone", () => {
    const totals = previewTotals(
      { ...valid, address: { ...valid.address, zone: "outside_dhaka" } },
      prices,
      DEFAULT_ORDER_SETTINGS,
    );
    expect(totals?.deliveryChargeMinor).toBe(12000);
    expect(totals?.totalMinor).toBe(50000 + 12000);
  });
});

describe("validateOrderForm", () => {
  it("accepts a complete form", () => {
    expect(validateOrderForm(valid)).toEqual({ ok: true });
  });

  it("reports each problem against the field that shows it", () => {
    const result = validateOrderForm({
      ...EMPTY_ORDER_VALUES,
      lines: [{ productId: "", variantId: "", quantity: "0" }],
      discount: "x",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const byName = Object.fromEntries(result.fields.map((f) => [f.name, f.message]));
    expect(byName.customerId).toBe("Choose a customer");
    expect(byName["lines.0.productId"]).toBe("Choose a product");
    expect(byName["lines.0.quantity"]).toMatch(/quantity/i);
    expect(byName["address.recipientName"]).toBeTruthy();
    expect(byName["address.phone"]).toBeTruthy();
    expect(byName["address.line1"]).toBeTruthy();
    expect(byName["address.zone"]).toBeTruthy();
    expect(byName.discount).toBeTruthy();
  });

  it("asks for at least one item", () => {
    const result = validateOrderForm({ ...valid, lines: [] });
    expect(result).toEqual({
      ok: false,
      fields: [{ name: "lines.root", message: "Add at least one item" }],
    });
  });
});

describe("mapOrderApiError", () => {
  const validation = (details: Array<{ path: string; message: string }>) =>
    new ApiError({ status: 400, code: "VALIDATION_ERROR", message: "Invalid", details });

  it("maps lines.N details onto row N with friendly copy", () => {
    const mapped = mapOrderApiError(
      validation([
        { path: "lines.1", message: "out_of_stock" },
        { path: "lines.0", message: "unavailable" },
        { path: "lines.2", message: "invalid_variant" },
      ]),
    );
    expect(mapped.fields).toEqual([
      { name: "lines.1.root", message: "Not enough stock" },
      { name: "lines.0.root", message: "This product isn't available" },
      { name: "lines.2.root", message: "Choose a variant" },
    ]);
    expect(mapped.formError).toBeNull();
  });

  it("maps address, discount and unknown paths", () => {
    const mapped = mapOrderApiError(
      validation([
        { path: "shippingAddress.phone", message: "Enter a valid phone number" },
        { path: "discountMinor", message: "The discount can't be more than the subtotal" },
        { path: "somethingElse", message: "Odd" },
      ]),
    );
    expect(mapped.fields).toEqual([
      { name: "address.phone", message: "Enter a valid phone number" },
      { name: "discount", message: "The discount can't be more than the subtotal" },
    ]);
    expect(mapped.formError).toBe("Odd");
  });

  it("shows a conflict's server message as the form error", () => {
    const mapped = mapOrderApiError(
      new ApiError({
        status: 409,
        code: "CONFLICT",
        message: "This order is still being prepared, try again",
      }),
    );
    expect(mapped).toMatchObject({
      fields: [],
      formError: "This order is still being prepared, try again",
    });
  });
});

describe("orderToFormValues and buildDraftPatch", () => {
  const order = {
    customerId: "cust1",
    customerSnapshot: { name: "Rahim", phoneE164: "+8801712345678" },
    lines: [
      { productId: "p1", variantId: "default", quantity: 2 },
      { productId: "p2", variantId: "xl-red", quantity: 1 },
    ],
    shippingAddress: {
      recipientName: "Rahim Uddin",
      phone: "01712345678",
      phoneE164: "+8801712345678",
      line1: "House 4",
      zone: "outside_dhaka",
    },
    paymentMethod: "online",
    discountMinor: 15050,
    notes: null,
  } as unknown as Order;

  const initial = orderToFormValues(order);

  it("maps a stored order onto the form", () => {
    expect(initial.lines).toEqual([
      { productId: "p1", variantId: "", quantity: "2" },
      { productId: "p2", variantId: "xl-red", quantity: "1" },
    ]);
    expect(initial.discount).toBe("150.50");
    expect(initial.notes).toBe("");
    expect(initial.address).toMatchObject({
      recipientName: "Rahim Uddin",
      zone: "outside_dhaka",
      area: "",
    });
    expect(initial.paymentMethod).toBe("online");
  });

  it("sends nothing when nothing changed", () => {
    expect(buildDraftPatch(initial, structuredClone(initial))).toEqual({});
  });

  it("sends only the fields that changed", () => {
    const next = structuredClone(initial);
    next.lines[0]!.quantity = "3";
    next.discount = "0";
    expect(buildDraftPatch(initial, next)).toEqual({
      lines: [
        { productId: "p1", quantity: 3 },
        { productId: "p2", variantId: "xl-red", quantity: 1 },
      ],
      discountMinor: 0,
    });
  });

  it("sends the address whole, the payment method and cleared notes", () => {
    const next = structuredClone(initial);
    next.address.line1 = "House 9";
    next.paymentMethod = "cod";
    next.notes = "  ";
    const patch = buildDraftPatch({ ...initial, notes: "old" }, next);
    expect(patch.shippingAddress).toMatchObject({ line1: "House 9", recipientName: "Rahim Uddin" });
    expect(patch.paymentMethod).toBe("cod");
    expect(patch.notes).toBe("");
    expect(patch).not.toHaveProperty("lines");
  });
});
