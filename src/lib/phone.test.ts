import { describe, expect, it } from "vitest";

import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["01712-345678"],
    ["+880 1712 345678"],
    ["8801712345678"],
    ["+8801712345678"],
    ["008801712345678"],
    ["01712345678"],
    ["(017) 12.345-678"],
    ["  01712345678  "],
  ])("normalizes BD mobile %j", (raw) => {
    expect(normalizePhone(raw)).toBe("+8801712345678");
  });

  it("maps Bangla digits", () => {
    expect(normalizePhone("০১৭১২৩৪৫৬৭৮")).toBe("+8801712345678");
    expect(normalizePhone("+৮৮০ ১৭১২ ৩৪৫৬৭৮")).toBe("+8801712345678");
  });

  it("maps Arabic-Indic and Extended Arabic-Indic digits", () => {
    expect(normalizePhone("٠١٧١٢٣٤٥٦٧٨")).toBe("+8801712345678");
    expect(normalizePhone("۰۱۷۱۲۳۴۵۶۷۸")).toBe("+8801712345678");
  });

  it("accepts every valid BD operator prefix 013-019", () => {
    for (const d of [3, 4, 5, 6, 7, 8, 9]) {
      expect(normalizePhone(`01${d}12345678`)).toBe(`+8801${d}12345678`);
    }
  });

  it("accepts other countries in international form", () => {
    expect(normalizePhone("+14155552671")).toBe("+14155552671");
    expect(normalizePhone("+1 (415) 555-2671")).toBe("+14155552671");
    expect(normalizePhone("0044 7911 123456")).toBe("+447911123456");
    expect(normalizePhone("+447911123456")).toBe("+447911123456");
  });

  it.each([
    ["abc"],
    [""],
    ["   "],
    ["12345"],
    ["01012345678"], // wrong operator prefix
    ["01212345678"],
    ["0171234567"], // too short
    ["017123456789"], // too long
    ["+8801012345678"],
    ["8801212345678"],
    ["01712345678 ext 5"],
    ["01712345678 x5"],
    ["01712345678, 01812345678"],
    ["01712345678/01812345678"],
    ["+"],
    ["++8801712345678"],
    ["+0123456789"], // country code cannot start with 0
    ["+1234567"], // 7 digits: too short
    ["+1234567890123456"], // 16 digits: too long
    ["+1415555abcd"],
    ["1712345678"], // national form without leading zero is ambiguous
    ["---"],
    ["()"],
  ])("rejects %j", (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });

  it.each([
    ["LRM/RLM", "‎+880 1712 345678‏"],
    ["LRE/RLE/PDF", "‪+8801712345678‬"],
    ["RLE + PDF", "‫+8801712345678‬"],
    ["LRO/RLO", "‭01712345678‮"],
    ["isolates", "⁦⁧⁨+8801712345678⁩"],
    ["zero-width space", "01712​345678"],
    ["zero-width joiner/non-joiner", "0171‌2‍345678"],
    ["word joiner", "⁠+8801712345678"],
    ["BOM", "﻿01712345678"],
    ["NBSP and narrow NBSP", "+880 1712 345678"],
    ["ideographic space", "01712　345678"],
    ["full-width digits", "０１７１２３４５６７８"],
    ["full-width plus and digits", "＋８８０１７１２３４５６７８"],
  ])("tolerates pasted invisible characters: %s", (_name, raw) => {
    expect(normalizePhone(raw)).toBe("+8801712345678");
  });

  it("keeps the length cap in front of the expensive normalization", () => {
    const huge = "​".repeat(1_000_000);
    const start = performance.now();
    expect(normalizePhone(huge)).toBeNull();
    expect(normalizePhone("0".repeat(1_000_000))).toBeNull();
    expect(performance.now() - start).toBeLessThan(250);
    // 64 characters (the cap) still works with padding; 65 does not.
    expect(normalizePhone(" ".repeat(51) + "01712345678")).toBe("+8801712345678");
    expect(normalizePhone(" ".repeat(54) + "01712345678")).toBeNull();
  });

  it("never throws on weird input", () => {
    const weird = [
      "x".repeat(100_000),
      "0".repeat(100_000),
      "+" + "1".repeat(100_000),
      "😀📞🇧🇩",
      "\u0000\u0001‮",
      "-.()  ",
      "০".repeat(50),
      "\ud800", // lone surrogate
      "+".repeat(1000),
      "\n\t",
    ];
    for (const raw of weird) {
      expect(() => normalizePhone(raw)).not.toThrow();
      expect(normalizePhone(raw)).toBeNull();
    }
  });

  it("returns null (does not throw) for non-string runtime values", () => {
    for (const raw of [undefined, null, 123, {}, []] as unknown[]) {
      expect(normalizePhone(raw as string)).toBeNull();
    }
  });

  it("returns null for a default country it does not support rather than guessing", () => {
    expect(normalizePhone("01712345678", "US")).toBeNull();
    expect(normalizePhone("+14155552671", "US")).toBe("+14155552671");
  });
});
