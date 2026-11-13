import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchOutboundJson } from "@/lib/api/outbound-http";
import { sealSecret } from "@/lib/security/secret-box";
import type { GatewayAccount } from "@/schemas/integration";

import { aamarPayGateway } from "./aamarpay";

vi.mock("@/lib/api/outbound-http", () => ({
  fetchOutboundJson: vi.fn(),
}));

const mockFetch = vi.mocked(fetchOutboundJson);

const TEST_KEY = Buffer.from("01234567890123456789012345678901").toString("base64");

function makeAccount(mode: "sandbox" | "live" = "sandbox"): GatewayAccount {
  const creds = JSON.stringify({ storeId: "aamar_test", signatureKey: "sig_123" });
  return {
    id: "gw_aamar_1",
    organizationId: "org_1",
    provider: "aamarpay",
    label: "aamarPay",
    mode,
    enabled: true,
    isDefault: false,
    credentials: sealSecret(creds, TEST_KEY),
    publicConfig: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("AamarPayGateway", () => {
  const origKey = process.env.ENCRYPTION_KEY;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    if (origKey !== undefined) process.env.ENCRYPTION_KEY = origKey;
    else delete process.env.ENCRYPTION_KEY;
  });

  it("createSession posts json payload and returns redirectUrl", async () => {
    mockFetch.mockResolvedValueOnce({
      result: "true",
      payment_url: "https://sandbox.aamarpay.com/pay/pay_token_123",
    });

    const account = makeAccount("sandbox");
    const res = await aamarPayGateway.createSession(account, {
      tranId: "tran_aamar_1",
      amountMinor: 20000,
      currency: "BDT",
      orderNumber: "SP-000005",
      customer: { name: "Karim", phoneE164: "+8801900000000" },
      urls: { success: "/s", fail: "/f", cancel: "/c", ipn: "/ipn" },
    });

    expect(res.redirectUrl).toBe("https://sandbox.aamarpay.com/pay/pay_token_123");
    expect(res.gatewayRef).toBe("tran_aamar_1");
  });

  it("verify checks pay_status and transaction ID", async () => {
    mockFetch.mockResolvedValueOnce({
      pay_status: "Successful",
      amount: "200.00",
      currency: "BDT",
      mer_txnid: "tran_aamar_1",
      pg_txnid: "AAMAR_PG_999",
    });

    const account = makeAccount("sandbox");
    const res = await aamarPayGateway.verify(account, {
      tranId: "tran_aamar_1",
    });

    expect(res.outcome).toBe("paid");
    expect(res.amountMinor).toBe(20000);
    expect(res.gatewayTxnId).toBe("AAMAR_PG_999");
  });

  it("verify fails when pay_status is not Successful", async () => {
    mockFetch.mockResolvedValueOnce({
      pay_status: "Failed",
      amount: "200.00",
      mer_txnid: "tran_aamar_1",
    });

    const account = makeAccount("sandbox");
    const res = await aamarPayGateway.verify(account, {
      tranId: "tran_aamar_1",
    });

    expect(res.outcome).toBe("failed");
  });

  it("parseCallback extracts mer_txnid and pg_txnid", () => {
    const parsed = aamarPayGateway.parseCallback({
      query: { mer_txnid: "tran_m", pg_txnid: "pg_x" },
    });
    expect(parsed.tranId).toBe("tran_m");
    expect(parsed.gatewayRef).toBe("pg_x");
  });
});
