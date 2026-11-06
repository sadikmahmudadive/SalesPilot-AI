import { describe, expect, it } from "vitest";

import { countLabel, isSearchActive } from "@/lib/list-ui";

describe("isSearchActive", () => {
  it("needs two non-space characters", () => {
    expect(isSearchActive("")).toBe(false);
    expect(isSearchActive(" a ")).toBe(false);
    expect(isSearchActive("ab")).toBe(true);
    expect(isSearchActive("  ab  ")).toBe(true);
  });
});

describe("countLabel", () => {
  it("pluralises", () => {
    expect(countLabel(1, "customer")).toBe("1 customer");
    expect(countLabel(0, "customer")).toBe("0 customers");
    expect(countLabel(2, "stock item", "stock items")).toBe("2 stock items");
  });
});
