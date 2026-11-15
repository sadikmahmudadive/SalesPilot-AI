import { describe, expect, it } from "vitest";

import {
  interpolateTemplate,
  signWebhookPayload,
  verifySecretHeader,
} from "./helpers";

describe("automation helpers", () => {
  it("interpolates placeholders and defaults missing keys to empty string", () => {
    const out = interpolateTemplate(
      "Hi {{customerName}}, order #{{orderNumber}} is ৳{{totalBdt}}. Missing={{missing}}.",
      { customerName: "Ayesha", orderNumber: "ORD-104", totalBdt: 1500 },
    );
    expect(out).toBe("Hi Ayesha, order #ORD-104 is ৳1500. Missing=.");
  });

  it("signs outbound webhook payloads consistently with HMAC-SHA256", () => {
    const body = JSON.stringify({ event: "order_confirmed", orderNumber: "ORD-104" });
    const sig1 = signWebhookPayload("super_secret", body);
    const sig2 = signWebhookPayload("super_secret", body);
    const sigOther = signWebhookPayload("other_secret", body);

    expect(sig1.startsWith("sha256=")).toBe(true);
    expect(sig1).toBe(sig2);
    expect(sig1).not.toBe(sigOther);
  });

  it("verifies inbound secrets in constant time", () => {
    expect(verifySecretHeader("my_token_123", "my_token_123")).toBe(true);
    expect(verifySecretHeader("my_token_124", "my_token_123")).toBe(false);
    expect(verifySecretHeader("short", "much_longer_secret")).toBe(false);
    expect(verifySecretHeader(undefined, "my_token_123")).toBe(false);
  });
});
