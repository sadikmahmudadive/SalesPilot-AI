import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { isValidIdSegment } from "./ids";

describe("isValidIdSegment", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts ordinary ids and rejects structurally invalid ones", () => {
    expect(isValidIdSegment("uid_123")).toBe(true);
    for (const bad of ["", ".", "..", "a/b", "__x__", 5, null, undefined, {}]) {
      expect(isValidIdSegment(bad)).toBe(false);
    }
  });

  it("enforces the 1500 UTF-8 byte limit at the boundary for multi-byte input", () => {
    expect(isValidIdSegment("a".repeat(1500))).toBe(true);
    expect(isValidIdSegment("a".repeat(1501))).toBe(false);
    // 2-byte characters: 750 * 2 = 1500 bytes fits, 751 * 2 = 1502 does not (751 UTF-16 units).
    expect(isValidIdSegment("\u00e9".repeat(750))).toBe(true);
    expect(isValidIdSegment("\u00e9".repeat(751))).toBe(false);
    // 3-byte characters: 500 * 3 = 1500 fits, 501 * 3 = 1503 does not.
    expect(isValidIdSegment("\u20ac".repeat(500))).toBe(true);
    expect(isValidIdSegment("\u20ac".repeat(501))).toBe(false);
    // 4-byte characters (surrogate pairs): 375 * 4 = 1500 fits, 376 * 4 = 1504 does not.
    expect(isValidIdSegment("\u{1F600}".repeat(375))).toBe(true);
    expect(isValidIdSegment("\u{1F600}".repeat(376))).toBe(false);
  });

  it("does not depend on the Node-only Buffer global (client bundles)", () => {
    const source = readFileSync(join(__dirname, "ids.ts"), "utf8");
    expect(source).not.toMatch(/\bBuffer\b/);
    vi.stubGlobal("Buffer", undefined);
    expect(isValidIdSegment("\u20ac".repeat(500))).toBe(true);
    expect(isValidIdSegment("\u20ac".repeat(501))).toBe(false);
  });
});
