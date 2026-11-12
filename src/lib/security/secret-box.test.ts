import { describe, expect, it } from "vitest";

import { IntegrationNotConfiguredError, ValidationError } from "@/lib/errors";

import {
  isEncryptionConfigured,
  sealSecret,
  unsealSecret,
  type SealedSecret,
} from "./secret-box";

// A valid 32-byte test key (base64 encoded 32 random bytes)
const TEST_KEY = Buffer.from("01234567890123456789012345678901").toString("base64");
const ANOTHER_KEY = Buffer.from("abcdefghijklmnopqrstuvwxyz123456").toString("base64");

describe("secret-box (AES-256-GCM)", () => {
  it("encrypts and decrypts arbitrary strings correctly", () => {
    const payload = JSON.stringify({ storeId: "store_123", apiKey: "sec_abc123!@#" });
    const sealed = sealSecret(payload, TEST_KEY);

    expect(sealed.v).toBe(1);
    expect(sealed.iv).toBeTypeOf("string");
    expect(sealed.tag).toBeTypeOf("string");
    expect(sealed.data).toBeTypeOf("string");

    const unsealed = unsealSecret(sealed, TEST_KEY);
    expect(unsealed).toBe(payload);
  });

  it("produces distinct IVs and ciphertexts for identical inputs", () => {
    const payload = "same-secret";
    const sealed1 = sealSecret(payload, TEST_KEY);
    const sealed2 = sealSecret(payload, TEST_KEY);

    expect(sealed1.iv).not.toBe(sealed2.iv);
    expect(sealed1.data).not.toBe(sealed2.data);
    expect(unsealSecret(sealed1, TEST_KEY)).toBe(payload);
    expect(unsealSecret(sealed2, TEST_KEY)).toBe(payload);
  });

  it("fails decryption when decrypted with a different key", () => {
    const sealed = sealSecret("sensitive-token", TEST_KEY);
    expect(() => unsealSecret(sealed, ANOTHER_KEY)).toThrow(ValidationError);
  });

  it("fails with ValidationError when ciphertext is tampered", () => {
    const sealed = sealSecret("original-data", TEST_KEY);
    const tamperedData = Buffer.from(sealed.data, "base64");
    tamperedData[0] ^= 0xff; // flip bits
    const tampered: SealedSecret = {
      ...sealed,
      data: tamperedData.toString("base64"),
    };

    expect(() => unsealSecret(tampered, TEST_KEY)).toThrow(ValidationError);
  });

  it("fails with ValidationError when tag is tampered", () => {
    const sealed = sealSecret("original-data", TEST_KEY);
    const tamperedTag = Buffer.from(sealed.tag, "base64");
    tamperedTag[0] ^= 0xff;
    const tampered: SealedSecret = {
      ...sealed,
      tag: tamperedTag.toString("base64"),
    };

    expect(() => unsealSecret(tampered, TEST_KEY)).toThrow(ValidationError);
  });

  it("fails with ValidationError when IV is tampered", () => {
    const sealed = sealSecret("original-data", TEST_KEY);
    const tamperedIv = Buffer.from(sealed.iv, "base64");
    tamperedIv[0] ^= 0xff;
    const tampered: SealedSecret = {
      ...sealed,
      iv: tamperedIv.toString("base64"),
    };

    expect(() => unsealSecret(tampered, TEST_KEY)).toThrow(ValidationError);
  });

  it("fails with ValidationError when version is unsupported", () => {
    const sealed = sealSecret("original-data", TEST_KEY);
    const invalidVersion = { ...sealed, v: 2 as 1 };

    expect(() => unsealSecret(invalidVersion, TEST_KEY)).toThrow(ValidationError);
  });

  it("rejects keys that are not 32 bytes", () => {
    const shortKey = Buffer.from("too-short").toString("base64");
    expect(() => sealSecret("data", shortKey)).toThrow(ValidationError);
  });

  it("throws IntegrationNotConfiguredError if no key is provided and ENCRYPTION_KEY is unset", () => {
    const oldKey = process.env.ENCRYPTION_KEY;
    try {
      delete process.env.ENCRYPTION_KEY;
      expect(() => sealSecret("data")).toThrow(IntegrationNotConfiguredError);
    } finally {
      if (oldKey !== undefined) process.env.ENCRYPTION_KEY = oldKey;
    }
  });

  it("isEncryptionConfigured reflects whether a valid 32-byte key is configured", () => {
    const oldKey = process.env.ENCRYPTION_KEY;
    try {
      delete process.env.ENCRYPTION_KEY;
      expect(isEncryptionConfigured()).toBe(false);

      process.env.ENCRYPTION_KEY = "not-32-bytes";
      expect(isEncryptionConfigured()).toBe(false);

      process.env.ENCRYPTION_KEY = TEST_KEY;
      expect(isEncryptionConfigured()).toBe(true);
    } finally {
      if (oldKey !== undefined) process.env.ENCRYPTION_KEY = oldKey;
      else delete process.env.ENCRYPTION_KEY;
    }
  });
});
