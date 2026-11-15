import { beforeEach, describe, expect, it } from "vitest";

import type { GatewayAccount } from "@/schemas/integration";

import {
  MockPaymentGateway,
  mockGateway,
  resetMockStore,
  setMockOutcome,
} from "./mock";
import { getPaymentGateway } from "./registry";

const dummyAccount: GatewayAccount = {
  id: "gw_mock_1",
  organizationId: "org_1",
  provider: "mock",
  label: "Mock Gateway",
  mode: "mock",
  enabled: true,
  isDefault: true,
  credentials: { v: 1, iv: "iv", tag: "tag", data: "data" },
  publicConfig: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("MockPaymentGateway", () => {
  beforeEach(() => {
    resetMockStore();
  });

  it("can be resolved from the gateway registry", () => {
    const gw = getPaymentGateway("mock");
    expect(gw).toBeInstanceOf(MockPaymentGateway);
    expect(gw.id).toBe("mock");
  });

  it("passes connection test cleanly", async () => {
    await expect(mockGateway.testConnection(dummyAccount)).resolves.toBeUndefined();
  });

  it("creates a checkout session with redirect URL and pending state", async () => {
    const res = await mockGateway.createSession(dummyAccount, {
      tranId: "tran_123",
      amountMinor: 25000,
      currency: "BDT",
      orderNumber: "SP-000001",
      customer: { name: "Alice", phoneE164: "+8801700000000" },
      urls: { success: "/s", fail: "/f", cancel: "/c", ipn: "/ipn" },
    });

    expect(res.redirectUrl).toContain("tranId=tran_123");
    expect(res.gatewayRef).toBe("mock_ref_tran_123");

    // Initially pending
    const verifyInitial = await mockGateway.verify(dummyAccount, { tranId: "tran_123" });
    expect(verifyInitial.outcome).toBe("pending");
    expect(verifyInitial.amountMinor).toBe(25000);
    expect(verifyInitial.currency).toBe("BDT");
  });

  it("updates verify outcome when setMockOutcome is called", async () => {
    await mockGateway.createSession(dummyAccount, {
      tranId: "tran_456",
      amountMinor: 10000,
      currency: "BDT",
      orderNumber: "SP-000002",
      customer: { name: "Bob", phoneE164: "+8801800000000" },
      urls: { success: "/s", fail: "/f", cancel: "/c", ipn: "/ipn" },
    });

    setMockOutcome("tran_456", "paid");
    const verified = await mockGateway.verify(dummyAccount, { tranId: "tran_456" });
    expect(verified.outcome).toBe("paid");
    expect(verified.gatewayTxnId).toBe("mock_txn_tran_456");
  });

  it("parses callback arguments from query or body", () => {
    const fromQuery = mockGateway.parseCallback({
      query: { tranId: "tran_q", gatewayRef: "ref_q" },
    });
    expect(fromQuery.tranId).toBe("tran_q");
    expect(fromQuery.gatewayRef).toBe("ref_q");

    const fromBody = mockGateway.parseCallback({
      query: {},
      body: { tranId: "tran_b", gatewayRef: "ref_b" },
    });
    expect(fromBody.tranId).toBe("tran_b");
    expect(fromBody.gatewayRef).toBe("ref_b");
  });
});
