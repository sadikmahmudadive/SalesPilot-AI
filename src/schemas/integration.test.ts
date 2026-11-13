import { describe, expect, it } from "vitest";

import {
  GATEWAY_PROVIDERS,
  INTEGRATION_MODES,
  gatewayAccountInputSchema,
  gatewayAccountPatchSchema,
  gatewayAccountSchema,
  gatewayAccountSummarySchema,
} from "./integration";

describe("integration schemas", () => {
  it("validates gatewayAccountInputSchema with defaults", () => {
    const parsed = gatewayAccountInputSchema.parse({
      provider: "sslcommerz",
      label: "SSLCommerz Primary",
      mode: "sandbox",
    });

    expect(parsed.provider).toBe("sslcommerz");
    expect(parsed.label).toBe("SSLCommerz Primary");
    expect(parsed.mode).toBe("sandbox");
    expect(parsed.enabled).toBe(true);
    expect(parsed.isDefault).toBe(false);
    expect(parsed.publicConfig).toEqual({});
  });

  it("rejects invalid gateway providers or integration modes", () => {
    expect(() =>
      gatewayAccountInputSchema.parse({
        provider: "unknown-gateway",
        label: "Test",
        mode: "sandbox",
      }),
    ).toThrow();

    expect(() =>
      gatewayAccountInputSchema.parse({
        provider: "sslcommerz",
        label: "Test",
        mode: "invalid-mode",
      }),
    ).toThrow();
  });

  it("rejects empty or excessively long labels", () => {
    expect(() =>
      gatewayAccountInputSchema.parse({
        provider: "mock",
        label: "   ",
        mode: "mock",
      }),
    ).toThrow();

    expect(() =>
      gatewayAccountInputSchema.parse({
        provider: "mock",
        label: "a".repeat(51),
        mode: "mock",
      }),
    ).toThrow();
  });

  it("validates full gatewayAccountSchema", () => {
    const account = {
      id: "gw_123",
      organizationId: "org_456",
      provider: "aamarpay" as const,
      label: "aamarPay Sandbox",
      mode: "sandbox" as const,
      enabled: true,
      isDefault: true,
      credentials: {
        v: 1 as const,
        iv: "ivBase64==",
        tag: "tagBase64==",
        data: "encryptedData==",
      },
      publicConfig: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const parsed = gatewayAccountSchema.parse(account);
    expect(parsed.id).toBe("gw_123");
    expect(parsed.credentials.v).toBe(1);
  });

  it("validates gatewayAccountSummarySchema for client API outputs", () => {
    const summary = {
      id: "gw_123",
      organizationId: "org_456",
      provider: "uddoktapay" as const,
      label: "UddoktaPay Live",
      mode: "live" as const,
      enabled: true,
      isDefault: false,
      publicConfig: { baseUrl: "https://pay.example.com" },
      hasCredentials: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const parsed = gatewayAccountSummarySchema.parse(summary);
    expect(parsed.hasCredentials).toBe(true);
    expect(parsed.publicConfig).toEqual({ baseUrl: "https://pay.example.com" });
  });

  it("allows partial inputs for gatewayAccountPatchSchema", () => {
    const patch = gatewayAccountPatchSchema.parse({
      enabled: false,
      label: "New Label",
    });
    expect(patch.enabled).toBe(false);
    expect(patch.label).toBe("New Label");
  });

  it("exports expected list of providers and modes", () => {
    expect(GATEWAY_PROVIDERS).toEqual(["sslcommerz", "aamarpay", "uddoktapay", "mock"]);
    expect(INTEGRATION_MODES).toEqual(["sandbox", "live", "mock"]);
  });
});
