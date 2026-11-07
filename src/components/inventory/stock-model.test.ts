import { describe, expect, it } from "vitest";

import {
  isLowStockParam,
  parseQuantity,
  previewAdjustment,
  stockStatus,
  toDelta,
} from "@/components/inventory/stock-model";

describe("previewAdjustment", () => {
  const record = { onHand: 12, reserved: 2 };

  it("adds stock", () => {
    expect(previewAdjustment(record, 3)).toEqual({
      ok: true,
      onHand: { from: 12, to: 15 },
      available: { from: 10, to: 13 },
      summary: "On hand 12 -> 15, Available 10 -> 13",
    });
  });

  it("removes stock", () => {
    const p = previewAdjustment(record, -4);
    expect(p).toMatchObject({ ok: true, onHand: { from: 12, to: 8 }, available: { from: 10, to: 6 } });
  });

  it("allows dropping exactly to the reserved quantity", () => {
    const p = previewAdjustment(record, -10);
    expect(p).toMatchObject({ ok: true, onHand: { to: 2 }, available: { to: 0 } });
  });

  it("blocks dropping below the reserved quantity and explains why", () => {
    const p = previewAdjustment(record, -11);
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.problem).toBe("below-reserved");
      expect(p.message).toMatch(/reserved/i);
      expect(p.message).toContain("2");
    }
  });

  it("blocks going negative for a unit with nothing reserved", () => {
    const p = previewAdjustment({ onHand: 3, reserved: 0 }, -4);
    expect(p).toMatchObject({ ok: false, problem: "below-reserved" });
  });

  it("blocks results above the on-hand limit", () => {
    const p = previewAdjustment({ onHand: 999_999_999, reserved: 0 }, 5);
    expect(p).toMatchObject({ ok: false, problem: "too-many" });
  });

  it("treats zero and non-integers as no adjustment", () => {
    expect(previewAdjustment(record, 0)).toMatchObject({ ok: false, problem: "no-change" });
    expect(previewAdjustment(record, 1.5)).toMatchObject({ ok: false, problem: "no-change" });
    expect(previewAdjustment(record, Number.NaN)).toMatchObject({ ok: false, problem: "no-change" });
  });
});

describe("parseQuantity", () => {
  it("accepts positive whole numbers, with Bangla digits too", () => {
    expect(parseQuantity("15")).toEqual({ ok: true, value: 15 });
    expect(parseQuantity(" 7 ")).toEqual({ ok: true, value: 7 });
    expect(parseQuantity(String.fromCharCode(0x09e7, 0x09eb))).toEqual({ ok: true, value: 15 });
  });

  it("rejects empty, zero, signs, decimals, letters and huge numbers", () => {
    for (const bad of ["", "  ", "0", "-3", "+3", "2.5", "abc", "1e3", "1,000", "1000001", "99999999999999999999"]) {
      expect(parseQuantity(bad).ok, bad).toBe(false);
    }
    expect(parseQuantity("1000000")).toEqual({ ok: true, value: 1_000_000 });
  });
});

describe("toDelta", () => {
  it("signs the quantity by mode", () => {
    expect(toDelta(5, "add")).toBe(5);
    expect(toDelta(5, "remove")).toBe(-5);
  });
});

describe("stockStatus", () => {
  it("separates out of stock, low stock (<= 5) and healthy", () => {
    expect(stockStatus(0)).toBe("out");
    expect(stockStatus(-1)).toBe("out");
    expect(stockStatus(1)).toBe("low");
    expect(stockStatus(5)).toBe("low");
    expect(stockStatus(6)).toBe("ok");
  });
});

describe("isLowStockParam", () => {
  it("is true only for the exact value 'true'", () => {
    expect(isLowStockParam("true")).toBe(true);
  });

  it("is false for absent, false, other or repeated values", () => {
    for (const v of [undefined, "", "false", "TRUE", "1", "yes", ["true"], ["true", "true"]]) {
      expect(isLowStockParam(v), String(v)).toBe(false);
    }
  });
});
