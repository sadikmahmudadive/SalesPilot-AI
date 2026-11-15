import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchOutbound, fetchOutboundJson } from "@/lib/api/outbound-http";
import { sealSecret } from "@/lib/security/secret-box";
import type { CourierAccount } from "@/schemas/courier";

import { pathaoAdapter } from "./pathao";

vi.mock("@/lib/api/outbound-http", () => ({
  fetchOutbound: vi.fn(),
  fetchOutboundJson: vi.fn(),
}));

const mockFetch = vi.mocked(fetchOutbound);
const mockFetchJson = vi.mocked(fetchOutboundJson);

const TEST_KEY = Buffer.from("01234567890123456789012345678901").toString("base64");

function makeAccount(withTokenCache = false): CourierAccount {
  const creds = JSON.stringify({
    clientId: "test_client_id",
    clientSecret: "test_client_secret",
    username: "test_user",
    password: "test_password",
  });

  const tokenCache = withTokenCache
    ? sealSecret(
        JSON.stringify({
          accessToken: "cached_token_123",
          expiresAt: Date.now() + 3600 * 1000,
        }),
        TEST_KEY,
      )
    : undefined;

  return {
    id: "ca_pathao_1",
    organizationId: "org_1",
    provider: "pathao",
    label: "Pathao Express",
    mode: "sandbox",
    enabled: true,
    isDefault: true,
    credentials: sealSecret(creds, TEST_KEY),
    tokenCache,
    publicConfig: { storeId: 101 },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("PathaoAdapter", () => {
  const origKey = process.env.ENCRYPTION_KEY;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    if (origKey !== undefined) process.env.ENCRYPTION_KEY = origKey;
    else delete process.env.ENCRYPTION_KEY;
  });

  it("reuses cached token if valid", async () => {
    mockFetch.mockResolvedValueOnce(new Response("OK", { status: 200 }));

    const account = makeAccount(true);
    await pathaoAdapter.testConnection(account);

    // Should NOT call issue-token
    expect(mockFetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("issue-token"),
      expect.anything(),
    );

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("city-list"),
      expect.objectContaining({
        headers: { Authorization: "Bearer cached_token_123" },
      }),
    );
  });

  it("fetches fresh token if tokenCache is missing or expired", async () => {
    mockFetchJson.mockResolvedValueOnce({
      access_token: "fresh_token_456",
      token_type: "Bearer",
      expires_in: 3600,
    });
    mockFetch.mockResolvedValueOnce(new Response("OK", { status: 200 }));

    const account = makeAccount(false);
    await pathaoAdapter.testConnection(account);

    expect(mockFetchJson).toHaveBeenCalledWith(
      "https://courier-api-sandbox.pathao.com/aladdin/api/v1/issue-token",
      expect.objectContaining({
        method: "POST",
      }),
    );

    expect(account.tokenCache).toBeDefined();
  });

  it("lists locations (city, zone, area)", async () => {
    // 1. City
    mockFetchJson.mockResolvedValueOnce({
      data: {
        data: [{ city_id: 1, city_name: "Dhaka" }],
      },
    });

    const account = makeAccount(true);
    const cities = await pathaoAdapter.listLocations(account, "city");
    expect(cities).toEqual([{ id: "1", name: "Dhaka" }]);

    // 2. Zone
    mockFetchJson.mockResolvedValueOnce({
      data: {
        data: [{ zone_id: 101, zone_name: "Gulshan" }],
      },
    });
    const zones = await pathaoAdapter.listLocations(account, "zone", "1");
    expect(zones).toEqual([{ id: "101", name: "Gulshan" }]);
  });

  it("creates a parcel order", async () => {
    mockFetchJson.mockResolvedValueOnce({
      type: "success",
      message: "Order created successfully",
      data: {
        consignment_id: "PT-12345",
        merchant_order_id: "ORD-9999",
        order_status: "Pending",
        delivery_fee: 60,
      },
    });

    const account = makeAccount(true);
    const res = await pathaoAdapter.createParcel(account, {
      invoice: "ORD-9999",
      recipientName: "Customer A",
      recipientPhone: "01700000000",
      recipientAddress: "Banani, Dhaka",
      cityId: "1",
      zoneId: "101",
      codAmountMinor: 100000,
      weightKg: 0.5,
    });

    expect(res.consignmentId).toBe("PT-12345");
    expect(res.trackingCode).toBe("ORD-9999");
    expect(res.chargeMinor).toBe(6000);
    expect(res.trackingUrl).toContain("PT-12345");
  });

  it("getStatus returns order status", async () => {
    mockFetchJson.mockResolvedValueOnce({
      data: {
        consignment_id: "PT-12345",
        order_status: "In_Transit",
      },
    });

    const account = makeAccount(true);
    const res = await pathaoAdapter.getStatus(account, "PT-12345");
    expect(res.status).toBe("in_transit");
    expect(res.rawStatus).toBe("In_Transit");
  });

  it("answers webhook handshake", () => {
    const req = new Request("http://localhost/webhook?hub.challenge=test_challenge_123");
    const handshake = pathaoAdapter.webhookHandshake?.(req);
    expect(handshake).not.toBeNull();
    expect(handshake?.status).toBe(200);
  });

  it("verifies webhook with HMAC-SHA256 signature", () => {
    const secret = "pathao_webhook_secret";
    const body = JSON.stringify({ event: "order.delivered" });

    const sig = createHmac("sha256", secret).update(body).digest("hex");

    expect(
      pathaoAdapter.verifyWebhook({ "x-pathao-signature": sig }, body, secret),
    ).toBe(true);

    expect(
      pathaoAdapter.verifyWebhook({ "x-pathao-signature": "wrong" }, body, secret),
    ).toBe(false);
  });
});
