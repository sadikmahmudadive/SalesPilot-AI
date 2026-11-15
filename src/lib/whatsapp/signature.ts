import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Validates Meta WhatsApp webhook signatures (X-Hub-Signature-256).
 *
 * Header format: sha256={hmac_sha256_hex_hash}
 * Uses timingSafeEqual to prevent timing attacks.
 */
export function verifyWhatsAppSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;

  const providedHash = signatureHeader.slice(7).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(providedHash)) return false;

  const expectedHash = createHmac("sha256", appSecret)
    .update(typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody)
    .digest("hex");

  try {
    const providedBuffer = Buffer.from(providedHash, "hex");
    const expectedBuffer = Buffer.from(expectedHash, "hex");

    if (providedBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(providedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}
