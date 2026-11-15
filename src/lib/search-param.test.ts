import { describe, expect, it } from "vitest";

import { textParam } from "./search-param";

describe("textParam", () => {
  it("returns the first value, trimmed and capped", () => {
    expect(textParam("  nadia ")).toBe("nadia");
    expect(textParam(["first", "second"])).toBe("first");
    expect(textParam("x".repeat(150))).toHaveLength(100);
  });

  it("is empty when absent", () => {
    expect(textParam(undefined)).toBe("");
    expect(textParam([])).toBe("");
  });
});
