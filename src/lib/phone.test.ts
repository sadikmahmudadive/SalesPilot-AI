import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cleanPhoneInput, normalizePhone } from "./phone";

describe("source hygiene", () => {
  // Invisible, bidi, full-width and Bangla/Arabic digit characters must be written as escapes
  // in source: literally they are invisible or silently rewritten by editors and formatters.
  const FORBIDDEN_LITERALS =
    /[\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u0660-\u0669\u06F0-\u06F9\u09E6-\u09EF\uFF10-\uFF19]/u;

  it.each(["src/lib/phone.ts", "src/schemas/customer.ts"])(
    "%s has no literal invisible/format or Bangla/Arabic digit characters",
    (file) => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(FORBIDDEN_LITERALS);
    },
  );
});

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
    expect(normalizePhone("\u09E6\u09E7\u09ED\u09E7\u09E8\u09E9\u09EA\u09EB\u09EC\u09ED\u09EE")).toBe("+8801712345678");
    expect(normalizePhone("+\u09EE\u09EE\u09E6 \u09E7\u09ED\u09E7\u09E8 \u09E9\u09EA\u09EB\u09EC\u09ED\u09EE")).toBe("+8801712345678");
  });

  it("maps Arabic-Indic and Extended Arabic-Indic digits", () => {
    expect(normalizePhone("\u0660\u0661\u0667\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668")).toBe("+8801712345678");
    expect(normalizePhone("\u06F0\u06F1\u06F7\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8")).toBe("+8801712345678");
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
    ["LRM/RLM", "\u200E+880 1712 345678\u200F"],
    ["LRE/RLE/PDF", "\u202A+8801712345678\u202C"],
    ["RLE + PDF", "\u202B+8801712345678\u202C"],
    ["LRO/RLO", "\u202D01712345678\u202E"],
    ["isolates", "\u2066\u2067\u2068+8801712345678\u2069"],
    ["zero-width space", "01712\u200B345678"],
    ["zero-width joiner/non-joiner", "0171\u200C2\u200D345678"],
    ["word joiner", "\u2060+8801712345678"],
    ["BOM", "\uFEFF01712345678"],
    ["NBSP and narrow NBSP", "+880\u00A01712\u202F345678"],
    ["ideographic space", "01712\u3000345678"],
    ["full-width digits", "\uFF10\uFF11\uFF17\uFF11\uFF12\uFF13\uFF14\uFF15\uFF16\uFF17\uFF18"],
    ["full-width plus and digits", "\uFF0B\uFF18\uFF18\uFF10\uFF11\uFF17\uFF11\uFF12\uFF13\uFF14\uFF15\uFF16\uFF17\uFF18"],
  ])("tolerates pasted invisible characters: %s", (_name, raw) => {
    expect(normalizePhone(raw)).toBe("+8801712345678");
  });

  it("keeps the length cap in front of the expensive normalization", () => {
    const huge = "\u200B".repeat(1_000_000);
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
      "\u{1F600}\u{1F4DE}\u{1F1E7}\u{1F1E9}",
      "\u0000\u0001\u202E",
      "-.()  ",
      "\u09E6".repeat(50),
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

describe("cleanPhoneInput", () => {
  it("strips separators, maps Bangla digits and keeps a leading plus", () => {
    expect(cleanPhoneInput("+880 (171)-234.5678")).toBe("+8801712345678");
    expect(cleanPhoneInput(String.fromCodePoint(0x09e6, 0x09e7, 0x09ed))).toBe("017");
    expect(cleanPhoneInput(String.fromCodePoint(0x200b, 0xff10, 0xff11))).toBe("01");
  });
  it("is bounded and total: over-long or non-string input gives an empty string", () => {
    expect(cleanPhoneInput("1".repeat(65))).toBe("");
    expect(cleanPhoneInput("1".repeat(64))).toHaveLength(64);
    expect(cleanPhoneInput(undefined as never)).toBe("");
  });
  it("does not validate: letters survive", () => {
    expect(cleanPhoneInput("ab 12")).toBe("ab12");
  });
});
