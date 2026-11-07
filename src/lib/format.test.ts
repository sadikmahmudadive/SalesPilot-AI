import { describe, expect, it } from "vitest";

import { formatCount, formatDate, formatDateTime, formatMoneyMinor, formatDateOr } from "@/lib/format";

describe("formatMoneyMinor", () => {
  it("converts minor units (poisha) to taka", () => {
    expect(formatMoneyMinor(123456)).toMatch(/1,234\.56$/);
  });

  it("formats zero", () => {
    expect(formatMoneyMinor(0)).toMatch(/0\.00$/);
  });

  it("formats large values with grouping", () => {
    expect(formatMoneyMinor(123456789012)).toMatch(/1,234,567,890\.12$|12,34,56,78,90\.12$/);
  });

  it("includes a currency marker", () => {
    expect(formatMoneyMinor(100)).toMatch(/BDT|\p{Sc}/u);
  });

  it("falls back to a dash for non-finite input", () => {
    expect(formatMoneyMinor(Number.NaN)).toBe("-");
    expect(formatMoneyMinor(Number.POSITIVE_INFINITY)).toBe("-");
    expect(formatMoneyMinor(undefined)).toBe("-");
  });
});

describe("formatDate / formatDateTime", () => {
  it("renders in Asia/Dhaka regardless of the host timezone (UTC+6)", () => {
    // 20:30Z on the 6th is 02:30 on the 7th in Dhaka.
    expect(formatDate("2026-11-06T20:30:00.000Z")).toBe("7 Nov 2026");
    expect(formatDateTime("2026-11-06T20:30:00.000Z")).toBe("7 Nov 2026, 02:30");
  });

  it("returns a dash for null, undefined, empty and invalid dates", () => {
    for (const bad of [null, undefined, "", "not-a-date", "2026-13-45T00:00:00Z"]) {
      expect(formatDate(bad)).toBe("-");
      expect(formatDateTime(bad)).toBe("-");
    }
  });
});

describe("formatDateOr", () => {
  it("shows the date for a valid timestamp and the fallback label otherwise", () => {
    expect(formatDateOr("2026-11-06T20:30:00.000Z", "Never")).toBe("7 Nov 2026");
    expect(formatDateOr(null, "Never")).toBe("Never");
    expect(formatDateOr("garbage", "Never")).toBe("Never");
  });
});

describe("formatCount", () => {
  it("groups thousands the en-GB way", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
  });

  it("formats zero and small numbers plainly", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(42)).toBe("42");
  });

  it("falls back for non-finite or missing values", () => {
    expect(formatCount(Number.NaN)).toBe("-");
    expect(formatCount(Infinity)).toBe("-");
    expect(formatCount(null)).toBe("-");
    expect(formatCount(undefined)).toBe("-");
  });
});
