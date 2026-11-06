import { describe, expect, it } from "vitest";

import { initialsFor } from "./initials";

describe("initialsFor", () => {
  it("uses first and last word of the display name", () => {
    expect(initialsFor("Ada Lovelace", "a@b.co")).toBe("AL");
    expect(initialsFor("  ada   byron  lovelace ", null)).toBe("AL");
  });

  it("uses a single letter for a one-word name", () => {
    expect(initialsFor("Ada", null)).toBe("A");
  });

  it("falls back to the email local part", () => {
    expect(initialsFor(null, "jo.smith@example.com")).toBe("JS");
    expect(initialsFor("", "sadik_mahmud@example.com")).toBe("SM");
    expect(initialsFor(undefined, "jo@example.com")).toBe("J");
  });

  it("falls back to ? when nothing usable is available", () => {
    expect(initialsFor(null, null)).toBe("?");
    expect(initialsFor("  ", "@example.com")).toBe("?");
    expect(initialsFor("123 456", null)).toBe("?");
  });

  it("handles non-latin names and emoji without splitting code points", () => {
    expect(initialsFor("Émile Zola", null)).toBe("ÉZ");
    expect(initialsFor("😀 Smile", null)).toBe("S");
  });
});
