import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchOutboundJson } from "@/lib/api/outbound-http";
import { ValidationError } from "@/lib/errors";
import { sealSecret } from "@/lib/security/secret-box";
import type { GatewayAccount } from "@/schemas/integration";

import { uddoktaPayGateway, validateUddoktaPayBaseUrl } from "./uddoktapay";

vi.mock("@/lib/api/outbound-http", () => ({
  fetchOutboundJson: vi.fn(),
}));

const mockFetch = vi.mocked(fetchOutboundJson);

const TEST_KEY = Buffer.from("01234567890123456789012345678901").toString("base64");

function makeAccount(baseUrl = "https://pay.example.com"): GatewayAccount {
  const creds = JSON.stringify({ apiKey: "rt_key_123" });
  return {
    id: "gw_uddokta_1",
    organizationId: "org_1",
    provider: "uddoktapay",
    label: "UddoktaPay",
    mode: "live",
    enabled: true,
    isDefault: false,
    credentials: sealSecret(creds, TEST_KEY),
    publicConfig: { baseUrl },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("UddoktaPayGateway", () => {
  const origKey = process.env.ENCRYPTION_KEY;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    if (origKey !== undefined) process.env.ENCRYPTION_KEY = origKey;
    else delete process.env.ENCRYPTION_KEY;
  });

  describe("baseUrl SSRF validation", () => {
    it("accepts valid https public domain", () => {
      expect(validateUddoktaPayBaseUrl("https://pay.myshop.com/panel")).toBe("https://pay.myshop.com");
    });

    it("rejects non-https URLs", () => {
      expect(() => validateUddoktaPayBaseUrl("http://pay.myshop.com")).toThrow(ValidationError);
    });

    it("rejects localhost and private network names", () => {
      expect(() => validateUddoktaPayBaseUrl("https://localhost")).toThrow(ValidationError);
      expect(() => validateUddoktaPayBaseUrl("https://server.local")).toThrow(ValidationError);
      expect(() => validateUddoktaPayBaseUrl("https://service.internal")).toThrow(ValidationError);
      expect(() => validateUddoktaPayBaseUrl("https://router.lan")).toThrow(ValidationError);
    });

    it("rejects IP literals", () => {
      expect(() => validateUddoktaPayBaseUrl("https://127.0.0.1")).toThrow(ValidationError);
      expect(() => validateUddoktaPayBaseUrl("https://192.168.1.1")).toThrow(ValidationError);
      expect(() => validateUddoktaPayBaseUrl("https://10.0.0.1")).toThrow(ValidationError);
    });
  });

  it("createSession calls checkout API and returns redirectUrl", async () => {
    mockFetch.mockResolvedValueOnce({
      status: true,
      payment_url: "https://pay.example.com/checkout/inv_123",
    });

    const account = makeAccount();
    const res = await uddoktaPayGateway.createSession(account, {
      tranId: "tran_uddokta_1",
      amountMinor: 35000,
      currency: "BDT",
      orderNumber: "SP-000008",
      customer: { name: "Sadik", phoneE164: "+8801500000000" },
      urls: { success: "/s", fail: "/f", cancel: "/c", ipn: "/ipn" },
    });

    expect(res.redirectUrl).toBe("https://pay.example.com/checkout/inv_123");
  });

  it("verify checks COMPLETED status and invoice_id", async () => {
    mockFetch.mockResolvedValueOnce({
      status: "COMPLETED",
      amount: "350.00",
      invoice_id: "inv_123",
      metadata: { tranId: "tran_uddokta_1" },
    });

    const account = makeAccount();
    const res = await uddoktaPayGateway.verify(account, {
      tranId: "tran_uddokta_1",
      gatewayRef: "inv_123",
    });

    expect(res.outcome).toBe("paid");
    expect(res.amountMinor).toBe(35000);
    expect(res.gatewayTxnId).toBe("inv_123");
  });

  it("verify fails when status is not COMPLETED", async () => {
    mockFetch.mockResolvedValueOnce({
      status: "PENDING",
      amount: "350.00",
      invoice_id: "inv_123",
    });

    const account = makeAccount();
    const res = await uddoktaPayGateway.verify(account, {
      tranId: "tran_uddokta_1",
      gatewayRef: "inv_123",
    });

    expect(res.outcome).toBe("failed");
  });

  it("parseCallback extracts invoice_id and tranId", () => {
    const parsed = uddoktaPayGateway.parseCallback({
      query: { invoice_id: "inv_q", tranId: "tran_q" },
    });
    expect(parsed.gatewayRef).toBe("inv_q");
    expect(parsed.tranId).toBe("tran_q");
  });
});
