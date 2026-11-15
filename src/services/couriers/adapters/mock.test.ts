import { describe, expect, it } from "vitest";

import type { CourierAccount } from "@/schemas/courier";
import { getCourierAdapter } from "../registry";
import { MockCourierAdapter, mockCourierAdapter } from "./mock";

const dummyAccount: CourierAccount = {
  id: "ca_mock_1",
  organizationId: "org_1",
  provider: "mock",
  label: "Mock Logistics",
  mode: "mock",
  enabled: true,
  isDefault: true,
  credentials: {
    v: 1,
    iv: "iv",
    tag: "tag",
    data: "data",
  },
  publicConfig: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("MockCourierAdapter", () => {
  const adapter = new MockCourierAdapter();

  it("passes testConnection", async () => {
    await expect(adapter.testConnection(dummyAccount)).resolves.toBeUndefined();
  });

  it("creates a parcel with predictable consignment and tracking", async () => {
    const res = await adapter.createParcel(dummyAccount, {
      invoice: "ORD-1001",
      recipientName: "Hasan Mahmud",
      recipientPhone: "+8801711111111",
      recipientAddress: "Dhanmondi 27, Dhaka",
      codAmountMinor: 120000,
      weightKg: 1,
    });

    expect(res.consignmentId).toBe("mock_cid_ORD-1001");
    expect(res.trackingCode).toBe("MOCK_ORD-1001");
    expect(res.trackingUrl).toContain("ORD-1001");
    expect(res.chargeMinor).toBe(6000);
  });

  it("finds a parcel by invoice", async () => {
    const found = await adapter.findParcelByInvoice(dummyAccount, "ORD-1001");
    expect(found).not.toBeNull();
    expect(found?.consignmentId).toBe("mock_cid_ORD-1001");
    expect(found?.trackingCode).toBe("MOCK_ORD-1001");

    const empty = await adapter.findParcelByInvoice(dummyAccount, "");
    expect(empty).toBeNull();
  });

  it("returns status for consignment", async () => {
    const status = await adapter.getStatus(dummyAccount, "mock_cid_ORD-1001");
    expect(status.status).toBe("booked");
    expect(status.rawStatus).toBe("booked");
    expect(status.at).toBeInstanceOf(Date);
  });

  it("verifies webhook with secret header check", () => {
    expect(
      adapter.verifyWebhook({ "x-mock-secret": "secret123" }, "{}", "secret123"),
    ).toBe(true);
    expect(
      adapter.verifyWebhook({ "x-mock-secret": "wrong" }, "{}", "secret123"),
    ).toBe(false);
    expect(adapter.verifyWebhook({}, "{}", undefined)).toBe(true);
  });

  it("parses webhook payload into CourierStatusEvents", () => {
    const events = adapter.parseWebhook({
      consignmentId: "cid_1",
      trackingCode: "TRK_1",
      invoice: "ORD-1001",
      status: "delivered",
      at: "2026-11-13T00:00:00.000Z",
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.consignmentId).toBe("cid_1");
    expect(events[0]?.trackingCode).toBe("TRK_1");
    expect(events[0]?.invoice).toBe("ORD-1001");
    expect(events[0]?.status).toBe("delivered");
    expect(events[0]?.rawStatus).toBe("delivered");
  });

  it("lists mock location hierarchy", async () => {
    const cities = await adapter.listLocations(dummyAccount, "city");
    expect(cities).toEqual([
      { id: "1", name: "Dhaka" },
      { id: "2", name: "Chittagong" },
    ]);

    const zones = await adapter.listLocations(dummyAccount, "zone", "1");
    expect(zones).toHaveLength(2);

    const areas = await adapter.listLocations(dummyAccount, "area", "101");
    expect(areas).toHaveLength(2);
  });

  it("is registered in registry", () => {
    const resolved = getCourierAdapter("mock");
    expect(resolved).toBe(mockCourierAdapter);
  });
});
