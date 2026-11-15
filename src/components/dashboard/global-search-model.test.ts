import { describe, expect, it } from "vitest";

import { flattenHits, moveIndex, seeAllHref, type SearchResultsView } from "./global-search-model";

const hit = (id: string) => ({ id, title: id, subtitle: null, href: `/x/${id}` });

describe("flattenHits", () => {
  it("lists hits in group order and skips empty or hidden groups", () => {
    const results: SearchResultsView = {
      customers: [hit("c1"), hit("c2")],
      products: [],
      orders: null,
      conversations: [hit("v1")],
    };
    expect(flattenHits(results).map((r) => `${r.group}:${r.hit.id}`)).toEqual([
      "customers:c1",
      "customers:c2",
      "conversations:v1",
    ]);
  });

  it("is empty without results", () => {
    expect(flattenHits(undefined)).toEqual([]);
  });
});

describe("moveIndex", () => {
  it("wraps around in both directions", () => {
    expect(moveIndex(-1, 1, 3)).toBe(0);
    expect(moveIndex(2, 1, 3)).toBe(0);
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(-1, -1, 3)).toBe(2);
  });

  it("is -1 when there is nothing to select", () => {
    expect(moveIndex(0, 1, 0)).toBe(-1);
  });
});

describe("seeAllHref", () => {
  it("opens each list with the search", () => {
    expect(seeAllHref("customers", "nadia rahman")).toBe("/customers?q=nadia%20rahman");
    expect(seeAllHref("products", "LP-1")).toBe("/products?q=LP-1");
    expect(seeAllHref("orders", "SP-000012")).toBe("/orders?q=SP-000012");
    expect(seeAllHref("conversations", "01711")).toBe("/inbox?q=01711");
  });
});
