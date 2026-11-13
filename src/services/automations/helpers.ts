import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Replaces `{{key}}` placeholders with corresponding string/number values.
 * Missing keys resolve to an empty string.
 */
export function interpolateTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const val = vars[key];
    return val === null || val === undefined ? "" : String(val);
  });
}

/**
 * Produces an HMAC-SHA256 signature header value (`sha256=<hex>`) for outbound webhooks.
 */
export function signWebhookPayload(secret: string, rawBody: string): string {
  const hex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return `sha256=${hex}`;
}

function digestUtf8(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Constant-time equality check over SHA-256 digests so secret length never leaks.
 */
export function verifySecretHeader(headerValue: string | undefined, expectedSecret: string): boolean {
  if (!headerValue || !expectedSecret) return false;
  return timingSafeEqual(digestUtf8(headerValue), digestUtf8(expectedSecret));
}
