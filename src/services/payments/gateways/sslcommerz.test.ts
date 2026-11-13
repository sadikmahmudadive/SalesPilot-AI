import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchOutboundJson } from "@/lib/api/outbound-http";
import { sealSecret } from "@/lib/security/secret-box";
import type { GatewayAccount } from "@/schemas/integration";

import { sslcommerzGateway } from "./sslcommerz";

vi.mock("@/lib/api/outbound-http", () => ({
  fetchOutboundJson: vi.fn(),
}));

const mockFetch = vi.mocked(fetchOutboundJson);

const TEST_KEY = Buffer.from("01234567890123456789012345678901").toString("base64");

function makeAccount(mode: "sandbox" | "live" = "sandbox"): GatewayAccount {
  const creds = JSON.stringify({ storeId: "store_test", storePassword: "pwd" });
  return {
    id: "gw_ssl_1",
    organizationId: "org_1",
    provider: "sslcommerz",
    label: "SSLCommerz",
    mode,
    enabled: true,
    isDefault: true,
    credentials: sealSecret(creds, TEST_KEY),
    publicConfig: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("SSLCommerzGateway", () => {
  const origKey = process.env.ENCRYPTION_KEY;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    if (origKey !== undefined) process.env.ENCRYPTION_KEY = origKey;
    else delete process.env.ENCRYPTION_KEY;
  });

  it("createSession formats inputs and returns redirectUrl", async () => {
    mockFetch.mockResolvedValueOnce({
      status: "SUCCESS",
      GatewayPageURL: "https://sandbox.sslcommerz.com/gwprocess/checkout_123",
      sessionkey: "session_key_123",
    });

    const account = makeAccount("sandbox");
    const res = await sslcommerzGateway.createSession(account, {
      tranId: "tran_123",
      amountMinor: 15000,
      currency: "BDT",
      orderNumber: "SP-000001",
      customer: { name: "Rahim", phoneE164: "+8801700000000" },
      urls: { success: "/s", fail: "/f", cancel: "/c", ipn: "/ipn" },
    });

    expect(res.redirectUrl).toBe("https://sandbox.sslcommerz.com/gwprocess/checkout_123");
    expect(res.gatewayRef).toBe("session_key_123");
  });

  it("verify marks paid when status is VALID and tran_id matches", async () => {
    mockFetch.mockResolvedValueOnce({
      status: "VALID",
      amount: "150.00",
      currency: "BDT",
      tran_id: "tran_123",
      bank_tran_id: "bank_456",
      risk_level: "0",
    });

    const account = makeAccount("sandbox");
    const res = await sslcommerzGateway.verify(account, {
      tranId: "tran_123",
      gatewayRef: "val_789",
    });

    expect(res.outcome).toBe("paid");
    expect(res.amountMinor).toBe(15000);
    expect(res.gatewayTxnId).toBe("bank_456");
    expect(res.riskFlag).toBe(false);
  });

  it("verify detects risk flag when risk_level is 1", async () => {
    mockFetch.mockResolvedValueOnce({
      status: "VALIDATED",
      amount: "150.00",
      currency: "BDT",
      tran_id: "tran_123",
      bank_tran_id: "bank_456",
      risk_level: "1",
    });

    const account = makeAccount("sandbox");
    const res = await sslcommerzGateway.verify(account, {
      tranId: "tran_123",
      gatewayRef: "val_789",
    });

    expect(res.outcome).toBe("paid");
    expect(res.riskFlag).toBe(true);
  });

  it("verify fails when tran_id does not match", async () => {
    mockFetch.mockResolvedValueOnce({
      status: "VALID",
      amount: "150.00",
      currency: "BDT",
      tran_id: "different_tran",
      bank_tran_id: "bank_456",
    });

    const account = makeAccount("sandbox");
    const res = await sslcommerzGateway.verify(account, {
      tranId: "tran_123",
      gatewayRef: "val_789",
    });

    expect(res.outcome).toBe("failed");
  });

  it("parseCallback extracts val_id and tran_id from query or body", () => {
    const parsed = sslcommerzGateway.parseCallback({
      query: { val_id: "val_999", tran_id: "tran_999" },
    });
    expect(parsed.gatewayRef).toBe("val_999");
    expect(parsed.tranId).toBe("tran_999");
  });
});
