import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { IntegrationNotConfiguredError, ValidationError } from "@/lib/errors";

export interface SealedSecret {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits recommended for AES-GCM

/**
 * Normalises an encryption key input (base64 string, hex, or raw 32 bytes)
 * into a 32-byte Buffer.
 */
function resolveKey(explicitKey?: string): Buffer {
  const keyStr = explicitKey ?? process.env.ENCRYPTION_KEY;
  if (!keyStr) {
    throw new IntegrationNotConfiguredError("encryption");
  }

  // Try decoding as base64 first
  let buf = Buffer.from(keyStr, "base64");
  if (buf.length !== 32) {
    // If not 32 bytes base64, check if it's utf-8 32 chars or hex
    if (Buffer.byteLength(keyStr, "utf8") === 32) {
      buf = Buffer.from(keyStr, "utf8");
    } else if (keyStr.length === 64 && /^[0-9a-fA-F]+$/.test(keyStr)) {
      buf = Buffer.from(keyStr, "hex");
    }
  }

  if (buf.length !== 32) {
    throw new ValidationError(
      undefined,
      "ENCRYPTION_KEY must be a 32-byte key (base64-encoded, 64-character hex, or 32 raw bytes)",
    );
  }

  return buf;
}

/**
 * Checks whether a valid 32-byte ENCRYPTION_KEY is currently configured.
 */
export function isEncryptionConfigured(): boolean {
  try {
    resolveKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Seals a plaintext string into a SealedSecret object using AES-256-GCM.
 */
export function sealSecret(plainText: string, key?: string): SealedSecret {
  const keyBuf = resolveKey(key);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, keyBuf, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
  };
}

/**
 * Unseals a SealedSecret object back into its plaintext string.
 * Throws a ValidationError if the secret is tampered with or uses an invalid key.
 */
export function unsealSecret(sealed: SealedSecret, key?: string): string {
  if (sealed.v !== 1) {
    throw new ValidationError(undefined, `Unsupported secret version: ${String(sealed.v)}`);
  }

  const keyBuf = resolveKey(key);

  try {
    const iv = Buffer.from(sealed.iv, "base64");
    const tag = Buffer.from(sealed.tag, "base64");
    const data = Buffer.from(sealed.data, "base64");

    const decipher = createDecipheriv(ALGORITHM, keyBuf, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw new ValidationError(
      undefined,
      "Secret integrity check failed (tampered ciphertext, invalid tag, or incorrect key)",
    );
  }
}
