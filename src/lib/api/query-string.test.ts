import { describe, expect, it } from "vitest";

import { clean, setPaging } from "@/lib/api/query-string";

describe("clean", () => {
  it("trims strings and turns anything else into an empty string", () => {
    expect(clean("  a ")).toBe("a");
    expect(clean("   ")).toBe("");
    expect(clean(undefined)).toBe("");
  });
});

describe("setPaging", () => {
  it("sets a positive limit and a non-blank trimmed cursor", () => {
    const q = new URLSearchParams();
    setPaging(q, { limit: 25, cursor: " abc " });
    expect(q.toString()).toBe("limit=25&cursor=abc");
  });

  it("skips a non-positive limit and a blank cursor", () => {
    const q = new URLSearchParams();
    setPaging(q, { limit: 0, cursor: "  " });
    expect(q.toString()).toBe("");
  });
});
