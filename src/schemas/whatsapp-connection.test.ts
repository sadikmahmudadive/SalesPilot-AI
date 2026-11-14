import { describe, expect, it } from "vitest";

import {
  toConnectionSummary,
  whatsappConnectionInputSchema,
  type WhatsAppConnectionDoc,
} from "./whatsapp-connection";

const TOKEN = "EAAG-test-token-0123456789";

describe("whatsappConnectionInputSchema", () => {
  it("accepts numeric ids and a token, enabled by default", () => {
    const parsed = whatsappConnectionInputSchema.parse({
      phoneNumberId: " 106540352242922 ",
      businessAccountId: "102290129340398",
      accessToken: TOKEN,
    });
    expect(parsed).toEqual({
      phoneNumberId: "106540352242922",
      businessAccountId: "102290129340398",
      accessToken: TOKEN,
      enabled: true,
    });
  });

  it("rejects a non-numeric phone number id and a short token", () => {
    expect(
      whatsappConnectionInputSchema.safeParse({ phoneNumberId: "abc", businessAccountId: "102290129340398" })
        .success,
    ).toBe(false);
    expect(
      whatsappConnectionInputSchema.safeParse({
        phoneNumberId: "106540352242922",
        businessAccountId: "102290129340398",
        accessToken: "short",
      }).success,
    ).toBe(false);
  });

  it("treats a blank token as omitted (keep the saved one)", () => {
    const parsed = whatsappConnectionInputSchema.parse({
      phoneNumberId: "106540352242922",
      businessAccountId: "102290129340398",
      accessToken: "   ",
    });
    expect(parsed.accessToken).toBeUndefined();
  });
});

describe("toConnectionSummary", () => {
  it("reports not connected without a doc", () => {
    expect(toConnectionSummary(null, false)).toMatchObject({
      connected: false,
      hasAccessToken: false,
      webhookUrl: "/api/webhooks/whatsapp",
      platformWebhookReady: false,
    });
  });

  it("never carries the credentials", () => {
    const doc: WhatsAppConnectionDoc = {
      organizationId: "org1",
      phoneNumberId: "106540352242922",
      businessAccountId: "102290129340398",
      displayPhoneNumber: "+880 1711-000000",
      verifiedName: "Brand Booster",
      credentials: { v: 1, iv: "iv", tag: "tag", data: "secret-data" },
      enabled: true,
      lastTestedAt: null,
      lastTestResult: "ok",
      createdAt: "2026-11-14T00:00:00.000Z",
      updatedAt: "2026-11-14T00:00:00.000Z",
    };
    const summary = toConnectionSummary(doc, true);
    expect(summary).toMatchObject({ connected: true, hasAccessToken: true, verifiedName: "Brand Booster" });
    const text = JSON.stringify(summary);
    expect(text).not.toContain("credentials");
    expect(text).not.toContain("secret-data");
  });
});
