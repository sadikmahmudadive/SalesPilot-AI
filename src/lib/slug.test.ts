import { describe, expect, it } from "vitest";

import { MAX_SLUG_LENGTH, baseSlug, slugCandidates, slugify } from "./slug";

const cp = (...codes: number[]) => String.fromCodePoint(...codes);
// Bangla word with vowel signs (combining marks) that must survive.
const BN = cp(0x09b6, 0x09be, 0x09a1, 0x09bc, 0x09bf);

describe("slugify", () => {
  it("lower-cases, joins words with dashes and drops punctuation", () => {
    expect(slugify("  Cotton   Shirt (Slim Fit)! ")).toBe("cotton-shirt-slim-fit");
  });
  it("collapses repeated dashes and trims them", () => {
    expect(slugify("--a -- b--")).toBe("a-b");
    expect(slugify("a_b.c/d")).toBe("abcd");
  });
  it("keeps Bangla letters and their vowel signs", () => {
    expect(slugify(`${BN} ${BN}`)).toBe(`${BN}-${BN}`);
  });
  it("folds full-width letters (NFKC)", () => {
    expect(slugify(cp(0xff21, 0xff22))).toBe("ab");
  });
  it("is empty when nothing is slug-worthy", () => {
    expect(slugify("!!! ???")).toBe("");
    expect(slugify(cp(0x1f600))).toBe("");
  });
  it("is capped at 80 characters, never ends with a dash and never splits a pair", () => {
    const long = slugify(`${"a".repeat(79)} bbb`);
    expect(long).toBe("a".repeat(79));
    expect(slugify("a".repeat(200))).toHaveLength(MAX_SLUG_LENGTH);
    const astral = cp(0x1d7d8); // mathematical double-struck digit zero: NFKC folds it to "0"
    expect(slugify(astral.repeat(100))).toBe("0".repeat(80));
  });
  it("never contains a slash, dot or space", () => {
    expect(slugify("a/b.c d")).not.toMatch(/[/. ]/);
  });
});

describe("baseSlug", () => {
  it("falls back to the lower-cased SKU, then to a fixed word", () => {
    expect(baseSlug("!!!", "AB-12")).toBe("ab-12");
    expect(baseSlug("!!!", "..._")).toBe("product");
    expect(baseSlug("Shirt", "X1")).toBe("shirt");
  });
});

describe("slugCandidates", () => {
  it("returns base, base-2 ... base-20", () => {
    const c = slugCandidates("shirt");
    expect(c).toHaveLength(20);
    expect(c.slice(0, 3)).toEqual(["shirt", "shirt-2", "shirt-3"]);
    expect(c[19]).toBe("shirt-20");
  });
  it("keeps every candidate within 80 characters", () => {
    for (const c of slugCandidates("a".repeat(80)))
      expect(c.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
  });
});
