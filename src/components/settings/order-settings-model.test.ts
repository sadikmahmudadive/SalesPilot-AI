import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/client";
import { DEFAULT_ORDER_SETTINGS } from "@/schemas/order";

import {
  mapOrderSettingsApiError,
  settingsToForm,
  validateOrderSettingsForm,
  type OrderSettingsFormValues,
} from "./order-settings-model";

const values = (over: Partial<OrderSettingsFormValues> = {}): OrderSettingsFormValues => ({
  ...settingsToForm(DEFAULT_ORDER_SETTINGS),
  ...over,
});

describe("settingsToForm", () => {
  it("shows the charges in taka with two decimals", () => {
    expect(settingsToForm(DEFAULT_ORDER_SETTINGS)).toEqual({
      deliveryChargeInsideDhaka: "60.00",
      deliveryChargeOutsideDhaka: "120.00",
      draftHoldMinutes: "30",
      paymentHoldHours: "24",
    });
  });
});

describe("validateOrderSettingsForm", () => {
  it("round-trips the defaults unchanged", () => {
    expect(validateOrderSettingsForm(settingsToForm(DEFAULT_ORDER_SETTINGS))).toEqual({
      ok: true,
      settings: DEFAULT_ORDER_SETTINGS,
    });
  });

  it('turns "60" taka into 6000 paisa, never through a float', () => {
    const r = validateOrderSettingsForm(values({ deliveryChargeInsideDhaka: "60" }));
    expect(r).toMatchObject({ ok: true, settings: { deliveryChargeInsideDhakaMinor: 6000 } });
    const r2 = validateOrderSettingsForm(values({ deliveryChargeOutsideDhaka: "19.99" }));
    expect(r2).toMatchObject({ ok: true, settings: { deliveryChargeOutsideDhakaMinor: 1999 } });
  });

  it("accepts a zero charge (free delivery)", () => {
    expect(validateOrderSettingsForm(values({ deliveryChargeInsideDhaka: "0" }))).toMatchObject({
      ok: true,
      settings: { deliveryChargeInsideDhakaMinor: 0 },
    });
  });

  it('rejects "6o" with a message on that field only', () => {
    const r = validateOrderSettingsForm(values({ deliveryChargeInsideDhaka: "6o" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors)).toEqual(["deliveryChargeInsideDhaka"]);
    expect(r.errors.deliveryChargeInsideDhaka).toMatch(/amount/i);
  });

  it("rejects an empty charge and one above the 10,000 taka limit", () => {
    const empty = validateOrderSettingsForm(values({ deliveryChargeOutsideDhaka: " " }));
    expect(empty.ok).toBe(false);
    const big = validateOrderSettingsForm(values({ deliveryChargeOutsideDhaka: "10000.01" }));
    expect(big).toMatchObject({
      ok: false,
      errors: { deliveryChargeOutsideDhaka: "Enter 0 to 10,000 taka" },
    });
    expect(validateOrderSettingsForm(values({ deliveryChargeOutsideDhaka: "10000" })).ok).toBe(
      true,
    );
  });

  it("validates hold minutes (5 to 1440) and hours (1 to 168) as whole numbers", () => {
    expect(validateOrderSettingsForm(values({ draftHoldMinutes: "4" }))).toMatchObject({
      ok: false,
      errors: { draftHoldMinutes: "Enter 5 to 1440 minutes" },
    });
    expect(validateOrderSettingsForm(values({ draftHoldMinutes: "1440" })).ok).toBe(true);
    expect(validateOrderSettingsForm(values({ draftHoldMinutes: "10.5" })).ok).toBe(false);
    expect(validateOrderSettingsForm(values({ draftHoldMinutes: "" })).ok).toBe(false);
    expect(validateOrderSettingsForm(values({ paymentHoldHours: "0" }))).toMatchObject({
      ok: false,
      errors: { paymentHoldHours: "Enter 1 to 168 hours" },
    });
    expect(validateOrderSettingsForm(values({ paymentHoldHours: "168" })).ok).toBe(true);
    expect(validateOrderSettingsForm(values({ paymentHoldHours: "1e2" })).ok).toBe(false);
  });

  it("reports every bad field at once", () => {
    const r = validateOrderSettingsForm(
      values({ deliveryChargeInsideDhaka: "x", draftHoldMinutes: "1", paymentHoldHours: "999" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.errors).sort()).toEqual([
        "deliveryChargeInsideDhaka",
        "draftHoldMinutes",
        "paymentHoldHours",
      ]);
  });
});

describe("mapOrderSettingsApiError", () => {
  it("puts a validation detail on its field and anything else in the form message", () => {
    const e = new ApiError({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid",
      details: [
        { path: "draftHoldMinutes", message: "Enter 5 to 1440 minutes" },
        { path: "", message: "At least one field is required" },
      ],
    });
    expect(mapOrderSettingsApiError(e)).toMatchObject({
      fields: [{ name: "draftHoldMinutes", message: "Enter 5 to 1440 minutes" }],
      formError: "At least one field is required",
    });
  });

  it("maps charge paths onto the taka fields and a 403 to a permission message", () => {
    const e = new ApiError({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid",
      details: [{ path: "deliveryChargeOutsideDhakaMinor", message: "too big" }],
    });
    expect(mapOrderSettingsApiError(e).fields).toEqual([
      { name: "deliveryChargeOutsideDhaka", message: "too big" },
    ]);
    expect(
      mapOrderSettingsApiError(new ApiError({ status: 403, code: "FORBIDDEN", message: "no" }))
        .formError,
    ).toMatch(/permission/i);
  });
});
