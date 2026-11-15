import { describe, expect, it } from "vitest";

import {
  buildBookShipmentPayload,
  validateBookCourierForm,
  type BookCourierFormValues,
} from "./book-courier-model";

describe("validateBookCourierForm", () => {
  it("passes for valid simple inputs", () => {
    const values: BookCourierFormValues = {
      courierAccountId: "acc_123",
      weightKg: "0.5",
      codAmount: "1200",
      cityId: "",
      cityName: "",
      zoneId: "",
      zoneName: "",
      areaId: "",
      areaName: "",
      note: "Fragile",
    };
    const errors = validateBookCourierForm(values, false);
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it("requires courierAccountId", () => {
    const values: BookCourierFormValues = {
      courierAccountId: "",
      weightKg: "0.5",
      codAmount: "100",
      cityId: "",
      cityName: "",
      zoneId: "",
      zoneName: "",
      areaId: "",
      areaName: "",
      note: "",
    };
    const errors = validateBookCourierForm(values, false);
    expect(errors.courierAccountId).toBe("Select a courier account");
  });

  it("validates weight is positive", () => {
    const values: BookCourierFormValues = {
      courierAccountId: "acc_1",
      weightKg: "-1",
      codAmount: "100",
      cityId: "",
      cityName: "",
      zoneId: "",
      zoneName: "",
      areaId: "",
      areaName: "",
      note: "",
    };
    const errors = validateBookCourierForm(values, false);
    expect(errors.weightKg).toBe("Enter a valid weight in kg (greater than 0)");
  });

  it("requires city and zone when requiresLocation is true", () => {
    const values: BookCourierFormValues = {
      courierAccountId: "acc_pathao",
      weightKg: "0.5",
      codAmount: "500",
      cityId: "",
      cityName: "",
      zoneId: "",
      zoneName: "",
      areaId: "",
      areaName: "",
      note: "",
    };
    const errors = validateBookCourierForm(values, true);
    expect(errors.cityId).toBe("City is required");
    expect(errors.zoneId).toBe("Zone is required");
  });
});

describe("buildBookShipmentPayload", () => {
  it("converts form values to BookShipmentInput payload", () => {
    const values: BookCourierFormValues = {
      courierAccountId: "acc_123",
      weightKg: "1.25",
      codAmount: "1500.50",
      cityId: "c_1",
      cityName: "Dhaka",
      zoneId: "z_1",
      zoneName: "Gulshan",
      areaId: "a_1",
      areaName: "Road 1",
      note: " Leave at front desk ",
    };

    const payload = buildBookShipmentPayload(values);
    expect(payload.courierAccountId).toBe("acc_123");
    expect(payload.weightKg).toBe(1.25);
    expect(payload.codAmountMinor).toBe(150050);
    expect(payload.location).toEqual({
      cityId: "c_1",
      cityName: "Dhaka",
      zoneId: "z_1",
      zoneName: "Gulshan",
      areaId: "a_1",
      areaName: "Road 1",
    });
    expect(payload.note).toBe("Leave at front desk");
  });
});
