import { describe, expect, it } from "vitest";

import { formatMinorToTakaInput, parseTakaToMinor } from "@/lib/money";

const ok = (input: string): number => {
  const r = parseTakaToMinor(input);
  if (!r.ok) throw new Error(`expected ${JSON.stringify(input)} to parse, got: ${r.message}`);
  return r.minor;
};
const message = (input: string): string => {
  const r = parseTakaToMinor(input);
  if (r.ok) throw new Error(`expected ${JSON.stringify(input)} to be rejected, got ${r.minor}`);
  return r.message;
};

// Bangla digits built from code points: this file stays ASCII.
const bangla = (ascii: string) =>
  ascii.replace(/\d/g, (d) => String.fromCharCode(0x09e6 + Number(d)));

describe("parseTakaToMinor", () => {
  it("parses whole and fractional amounts exactly", () => {
    expect(ok("1200")).toBe(120000);
    expect(ok("1200.5")).toBe(120050);
    expect(ok("1200.50")).toBe(120050);
    expect(ok("0")).toBe(0);
    expect(ok("0.07")).toBe(7);
    expect(ok("1.10")).toBe(110);
    expect(ok("0.1")).toBe(10);
  });

  it("is exact where floating point multiplication is not", () => {
    // 19.99 * 100 === 1998.9999999999998 and 1.15 * 100 === 114.99999999999999 in IEEE 754.
    expect(ok("19.99")).toBe(1999);
    expect(ok("1.15")).toBe(115);
    expect(ok("4.35")).toBe(435);
    expect(ok("8.2")).toBe(820);
    expect(ok("0.29")).toBe(29);
  });

  it("accepts thousands separators and surrounding spaces", () => {
    expect(ok("1,200.50")).toBe(120050);
    expect(ok("1,200")).toBe(120000);
    expect(ok("10,00,000")).toBe(100_000_000); // South Asian (lakh) grouping
    expect(ok("1,00,000.25")).toBe(10_000_025);
    expect(ok("  250  ")).toBe(25000);
  });

  it("accepts Bangla digits", () => {
    expect(ok(bangla("1200"))).toBe(120000);
    expect(ok(bangla("12.5"))).toBe(1250);
    expect(ok(`${bangla("1")},${bangla("200")}.${bangla("50")}`)).toBe(120050);
  });

  it("accepts the maximum and rejects anything above it", () => {
    expect(ok("10000000")).toBe(1_000_000_000);
    expect(ok("10000000.00")).toBe(1_000_000_000);
    expect(message("10000000.01")).toMatch(/too large/i);
    expect(message("99999999999999999999")).toMatch(/too large/i);
  });

  it("rejects negatives", () => {
    expect(message("-5")).toMatch(/negative/i);
    expect(message("-0.5")).toMatch(/negative/i);
  });

  it("rejects more than two decimals, even zeros", () => {
    expect(message("1.234")).toMatch(/2 decimal/i);
    expect(message("1.500")).toMatch(/2 decimal/i);
  });

  it("rejects letters, symbols and malformed numbers", () => {
    for (const bad of ["abc", "12a", "1e3", "1.2.3", "1..2", "5.", ".5", "$5", "1 000", "1,2", ",100", "1,2345", "12,34,56", "1,000,00", "NaN", "Infinity", "0x10", "+5"]) {
      expect(parseTakaToMinor(bad).ok, bad).toBe(false);
    }
  });

  it("rejects empty and non-string input", () => {
    expect(message("")).toMatch(/enter/i);
    expect(message("   ")).toMatch(/enter/i);
    expect(parseTakaToMinor(undefined as unknown as string).ok).toBe(false);
  });

  it("always returns a safe integer", () => {
    for (const input of ["0.01", "9999999.99", "123456.78"]) {
      expect(Number.isSafeInteger(ok(input))).toBe(true);
    }
  });
});

describe("formatMinorToTakaInput", () => {
  it("always shows two decimals", () => {
    expect(formatMinorToTakaInput(1999)).toBe("19.99");
    expect(formatMinorToTakaInput(110)).toBe("1.10");
    expect(formatMinorToTakaInput(100)).toBe("1.00");
    expect(formatMinorToTakaInput(7)).toBe("0.07");
    expect(formatMinorToTakaInput(0)).toBe("0.00");
    expect(formatMinorToTakaInput(1_000_000_000)).toBe("10000000.00");
  });

  it("returns an empty string for values that are not whole non-negative numbers", () => {
    expect(formatMinorToTakaInput(-1)).toBe("");
    expect(formatMinorToTakaInput(1.5)).toBe("");
    expect(formatMinorToTakaInput(Number.NaN)).toBe("");
    expect(formatMinorToTakaInput(undefined as unknown as number)).toBe("");
  });

  it("round trips with parseTakaToMinor", () => {
    for (const minor of [0, 1, 7, 99, 100, 110, 1999, 120050, 999_999_999, 1_000_000_000]) {
      expect(ok(formatMinorToTakaInput(minor))).toBe(minor);
    }
    for (const text of ["19.99", "1.10", "0.07", "1200.50", "5.00"]) {
      expect(formatMinorToTakaInput(ok(text))).toBe(text);
    }
  });
});
