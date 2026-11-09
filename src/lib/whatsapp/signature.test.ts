import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyWhatsAppSignature } from "./signature";

describe("verifyWhatsAppSignature", () => {
  const secret = "test_meta_app_secret_12345";
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

  it("returns true for a valid HMAC-SHA256 signature", () => {
    const hash = createHmac("sha256", secret).update(body).digest("hex");
    const header = `sha256=${hash}`;

    expect(verifyWhatsAppSignature(body, header, secret)).toBe(true);
  });

  it("returns false if signature header is missing or null", () => {
    expect(verifyWhatsAppSignature(body, null, secret)).toBe(false);
    expect(verifyWhatsAppSignature(body, "", secret)).toBe(false);
  });

  it("returns false if signature header does not start with sha256=", () => {
    const hash = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWhatsAppSignature(body, hash, secret)).toBe(false);
    expect(verifyWhatsAppSignature(body, `sha1=${hash}`, secret)).toBe(false);
  });

  it("returns false if payload has been tampered with", () => {
    const hash = createHmac("sha256", secret).update(body).digest("hex");
    const header = `sha256=${hash}`;
    const tamperedBody = body + " ";

    expect(verifyWhatsAppSignature(tamperedBody, header, secret)).toBe(false);
  });

  it("returns false if wrong secret is used", () => {
    const hash = createHmac("sha256", "wrong_secret").update(body).digest("hex");
    const header = `sha256=${hash}`;

    expect(verifyWhatsAppSignature(body, header, secret)).toBe(false);
  });

  it("returns false for invalid hex string length in signature", () => {
    expect(verifyWhatsAppSignature(body, "sha256=invalid", secret)).toBe(false);
  });
});
