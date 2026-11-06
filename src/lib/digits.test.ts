import { describe, expect, it } from "vitest";

import { toAsciiDigits } from "@/lib/digits";

const from = (zero: number, ascii: string) =>
  ascii.replace(/\d/g, (d) => String.fromCharCode(zero + Number(d)));

describe("toAsciiDigits", () => {
  it("maps Bangla, Arabic-Indic and Extended Arabic-Indic digits", () => {
    expect(toAsciiDigits(from(0x09e6, "0123456789"))).toBe("0123456789");
    expect(toAsciiDigits(from(0x0660, "0123456789"))).toBe("0123456789");
    expect(toAsciiDigits(from(0x06f0, "0123456789"))).toBe("0123456789");
  });

  it("leaves everything else untouched", () => {
    expect(toAsciiDigits("1,200.50 abc +-")).toBe("1,200.50 abc +-");
    expect(toAsciiDigits("")).toBe("");
  });
});
