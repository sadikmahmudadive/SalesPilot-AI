import { describe, expect, it } from "vitest";

import {
  COURIER_PROVIDERS,
  COURIER_STATUSES,
  courierAccountInputSchema,
  courierAccountPatchSchema,
  courierAccountSchema,
  courierAccountSummarySchema,
  courierLocationSchema,
  orderShipmentSchema,
  toCourierSummary,
  type CourierAccount,
} from "./courier";

describe("courier schemas", () => {
  it("exports expected providers and statuses", () => {
    expect(COURIER_PROVIDERS).toEqual(["steadfast", "pathao", "redx", "mock"]);
    expect(COURIER_STATUSES).toContain("booked");
    expect(COURIER_STATUSES).toContain("picked_up");
    expect(COURIER_STATUSES).toContain("delivered");
    expect(COURIER_STATUSES).toContain("returned");
    expect(COURIER_STATUSES).toContain("cancelled");
    expect(COURIER_STATUSES).toContain("unknown");
  });

  it("validates courierLocationSchema with string or number id", () => {
    const loc1 = courierLocationSchema.parse({ id: 123, name: "Dhaka" });
    expect(loc1.id).toBe("123");
    expect(loc1.name).toBe("Dhaka");

    const loc2 = courierLocationSchema.parse({ id: "zone-456", name: "Gulshan" });
    expect(loc2.id).toBe("zone-456");
    expect(loc2.name).toBe("Gulshan");

    expect(() => courierLocationSchema.parse({ id: "", name: "" })).toThrow();
  });

  it("validates orderShipmentSchema", () => {
    const shipment = {
      courierAccountId: "ca_1",
      provider: "steadfast" as const,
      bookingState: "booked" as const,
      consignmentId: "cid_12345",
      trackingCode: "TRK12345",
      trackingUrl: "https://portal.packzy.com/tracking/TRK12345",
      status: "booked" as const,
      rawStatus: "in_review",
      codAmountMinor: 150000,
      weightKg: 0.5,
      location: {
        cityId: "1",
        cityName: "Dhaka",
      },
    };

    const parsed = orderShipmentSchema.parse(shipment);
    expect(parsed.provider).toBe("steadfast");
    expect(parsed.bookingState).toBe("booked");
    expect(parsed.status).toBe("booked");
    expect(parsed.weightKg).toBe(0.5);
  });

  it("validates courierAccountInputSchema with defaults", () => {
    const parsed = courierAccountInputSchema.parse({
      provider: "steadfast",
      label: "Steadfast Primary",
      mode: "sandbox",
    });

    expect(parsed.provider).toBe("steadfast");
    expect(parsed.label).toBe("Steadfast Primary");
    expect(parsed.mode).toBe("sandbox");
    expect(parsed.enabled).toBe(true);
    expect(parsed.isDefault).toBe(false);
    expect(parsed.publicConfig).toEqual({});
  });

  it("validates full courierAccountSchema and converts to summary safely", () => {
    const account: CourierAccount = {
      id: "ca_1",
      organizationId: "org_1",
      provider: "pathao",
      label: "Pathao Sandbox",
      mode: "sandbox",
      enabled: true,
      isDefault: true,
      credentials: {
        v: 1,
        iv: "iv",
        tag: "tag",
        data: "encrypted",
      },
      webhookSecret: {
        v: 1,
        iv: "iv2",
        tag: "tag2",
        data: "encrypted2",
      },
      publicConfig: { storeId: 101 },
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    const parsed = courierAccountSchema.parse(account);
    expect(parsed.id).toBe("ca_1");

    const summary = toCourierSummary(account);
    const validatedSummary = courierAccountSummarySchema.parse(summary);

    expect(validatedSummary.id).toBe("ca_1");
    expect(validatedSummary.hasCredentials).toBe(true);
    expect(validatedSummary.hasWebhookSecret).toBe(true);
    expect((summary as Record<string, unknown>).credentials).toBeUndefined();
  });

  it("validates courierAccountPatchSchema", () => {
    const patch = courierAccountPatchSchema.parse({
      label: "New Label",
      enabled: false,
    });
    expect(patch.label).toBe("New Label");
    expect(patch.enabled).toBe(false);
  });
});
