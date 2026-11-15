import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchOutbound, fetchOutboundJson } from "@/lib/api/outbound-http";
import { sealSecret } from "@/lib/security/secret-box";
import type { CourierAccount } from "@/schemas/courier";

import { steadfastAdapter } from "./steadfast";

vi.mock("@/lib/api/outbound-http", () => ({
  fetchOutbound: vi.fn(),
  fetchOutboundJson: vi.fn(),
}));

const mockFetch = vi.mocked(fetchOutbound);
const mockFetchJson = vi.mocked(fetchOutboundJson);

const TEST_KEY = Buffer.from("01234567890123456789012345678901").toString("base64");

function makeAccount(): CourierAccount {
  const creds = JSON.stringify({ apiKey: "test_api_key", secretKey: "test_secret_key" });
  return {
    id: "ca_steadfast_1",
    organizationId: "org_1",
    provider: "steadfast",
    label: "Steadfast Courier",
    mode: "sandbox",
    enabled: true,
    isDefault: true,
    credentials: sealSecret(creds, TEST_KEY),
    publicConfig: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("SteadfastAdapter", () => {
  const origKey = process.env.ENCRYPTION_KEY;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    if (origKey !== undefined) process.env.ENCRYPTION_KEY = origKey;
    else delete process.env.ENCRYPTION_KEY;
  });

  it("testConnection calls get_balance with auth headers", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 200, current_balance: 500 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const account = makeAccount();
    await expect(steadfastAdapter.testConnection(account)).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://portal.packzy.com/api/v1/get_balance",
      expect.objectContaining({
        method: "GET",
        headers: {
          "Api-Key": "test_api_key",
          "Secret-Key": "test_secret_key",
        },
      }),
    );
  });

  it("createParcel formats order payload and returns consignment", async () => {
    mockFetchJson.mockResolvedValueOnce({
      status: 200,
      message: "Order created successfully",
      consignment: {
        consignment_id: 123456,
        invoice: "ORD-9999",
        tracking_code: "ST9999XYZ",
        status: "in_review",
      },
    });

    const account = makeAccount();
    const res = await steadfastAdapter.createParcel(account, {
      invoice: "ORD-9999",
      recipientName: "Tanvir Hossain",
      recipientPhone: "01811111111",
      recipientAddress: "Mirpur 10, Dhaka",
      codAmountMinor: 150000,
      weightKg: 1,
      note: "Handle with care",
    });

    expect(res.consignmentId).toBe("123456");
    expect(res.trackingCode).toBe("ST9999XYZ");
    expect(res.trackingUrl).toContain("ST9999XYZ");
  });

  it("findParcelByInvoice returns null if not found", async () => {
    mockFetchJson.mockResolvedValueOnce({
      status: 404,
      message: "Invoice not found",
    });

    const account = makeAccount();
    const res = await steadfastAdapter.findParcelByInvoice(account, "UNKNOWN-INV");
    expect(res).toBeNull();
  });

  it("getStatus retrieves delivery status", async () => {
    mockFetchJson.mockResolvedValueOnce({
      status: 200,
      delivery_status: "in_transit",
    });

    const account = makeAccount();
    const res = await steadfastAdapter.getStatus(account, "123456");
    expect(res.status).toBe("in_transit");
    expect(res.rawStatus).toBe("in_transit");
  });

  it("verifies webhook with Bearer token", () => {
    expect(
      steadfastAdapter.verifyWebhook(
        { authorization: "Bearer my-secret-token" },
        "{}",
        "my-secret-token",
      ),
    ).toBe(true);

    expect(
      steadfastAdapter.verifyWebhook(
        { authorization: "Bearer wrong-token" },
        "{}",
        "my-secret-token",
      ),
    ).toBe(false);
  });

  it("parses webhook payload into status events", () => {
    const events = steadfastAdapter.parseWebhook([
      {
        consignment_id: 123456,
        invoice: "ORD-9999",
        tracking_code: "ST9999XYZ",
        status: "delivered",
        updated_at: "2026-11-13T10:00:00Z",
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]?.consignmentId).toBe("123456");
    expect(events[0]?.status).toBe("delivered");
  });
});
