import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchOutbound, fetchOutboundJson } from "@/lib/api/outbound-http";
import { sealSecret } from "@/lib/security/secret-box";
import type { CourierAccount } from "@/schemas/courier";

import { redxAdapter } from "./redx";

vi.mock("@/lib/api/outbound-http", () => ({
  fetchOutbound: vi.fn(),
  fetchOutboundJson: vi.fn(),
}));

const mockFetch = vi.mocked(fetchOutbound);
const mockFetchJson = vi.mocked(fetchOutboundJson);

const TEST_KEY = Buffer.from("01234567890123456789012345678901").toString("base64");

function makeAccount(): CourierAccount {
  const creds = JSON.stringify({ accessToken: "test_redx_token" });
  return {
    id: "ca_redx_1",
    organizationId: "org_1",
    provider: "redx",
    label: "RedX Logistics",
    mode: "sandbox",
    enabled: true,
    isDefault: true,
    credentials: sealSecret(creds, TEST_KEY),
    publicConfig: { pickupStoreId: 42 },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("RedXAdapter", () => {
  const origKey = process.env.ENCRYPTION_KEY;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    if (origKey !== undefined) process.env.ENCRYPTION_KEY = origKey;
    else delete process.env.ENCRYPTION_KEY;
  });

  it("testConnection calls /areas with API-ACCESS-TOKEN header", async () => {
    mockFetch.mockResolvedValueOnce(new Response("OK", { status: 200 }));

    const account = makeAccount();
    await expect(redxAdapter.testConnection(account)).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://sandbox.redx.com.bd/v1.0.0-beta/areas?limit=1",
      expect.objectContaining({
        headers: { "API-ACCESS-TOKEN": "Bearer test_redx_token" },
      }),
    );
  });

  it("listLocations maps area list", async () => {
    mockFetchJson.mockResolvedValueOnce({
      areas: [
        { id: 1, name: "Uttara", district_name: "Dhaka" },
        { id: 2, name: "Agrabad", district_name: "Chittagong" },
      ],
    });

    const account = makeAccount();
    const areas = await redxAdapter.listLocations(account, "area");
    expect(areas).toEqual([
      { id: "1", name: "Dhaka - Uttara" },
      { id: "2", name: "Chittagong - Agrabad" },
    ]);
  });

  it("creates a parcel and returns trackingId", async () => {
    mockFetchJson.mockResolvedValueOnce({
      tracking_id: "REDX9999",
    });

    const account = makeAccount();
    const res = await redxAdapter.createParcel(account, {
      invoice: "ORD-1234",
      recipientName: "Sabbir Ahmed",
      recipientPhone: "01999999999",
      recipientAddress: "Sector 3, Uttara",
      areaId: "1",
      areaName: "Uttara",
      codAmountMinor: 80000,
      weightKg: 1,
    });

    expect(res.consignmentId).toBe("REDX9999");
    expect(res.trackingCode).toBe("REDX9999");
    expect(res.trackingUrl).toContain("REDX9999");
  });

  it("finds parcel by invoice", async () => {
    mockFetchJson.mockResolvedValueOnce({
      parcel: {
        tracking_id: "REDX9999",
      },
    });

    const account = makeAccount();
    const res = await redxAdapter.findParcelByInvoice(account, "ORD-1234");
    expect(res?.consignmentId).toBe("REDX9999");
  });

  it("getStatus returns parcel delivery status", async () => {
    mockFetchJson.mockResolvedValueOnce({
      parcel: {
        tracking_id: "REDX9999",
        status: "delivered",
      },
    });

    const account = makeAccount();
    const res = await redxAdapter.getStatus(account, "REDX9999");
    expect(res.status).toBe("delivered");
    expect(res.rawStatus).toBe("delivered");
  });

  it("verifies webhook with secret header", () => {
    expect(
      redxAdapter.verifyWebhook({ "x-redx-secret": "sec" }, "{}", "sec"),
    ).toBe(true);

    expect(
      redxAdapter.verifyWebhook({ "x-redx-secret": "wrong" }, "{}", "sec"),
    ).toBe(false);
  });
});
