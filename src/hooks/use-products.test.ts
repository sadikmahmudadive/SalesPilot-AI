import { describe, expect, it } from "vitest";

import { buildProductsQuery } from "@/hooks/use-products";

const keys = (p: Parameters<typeof buildProductsQuery>[0]) => [...buildProductsQuery(p).keys()];

describe("buildProductsQuery", () => {
  it("is empty for no params", () => {
    expect(buildProductsQuery({}).toString()).toBe("");
  });

  it("includes sort, dir, limit, cursor and archived=true", () => {
    const q = buildProductsQuery({
      sort: "name",
      dir: "asc",
      limit: 25,
      cursor: "abc",
      archived: true,
    });
    expect(q.get("sort")).toBe("name");
    expect(q.get("dir")).toBe("asc");
    expect(q.get("limit")).toBe("25");
    expect(q.get("cursor")).toBe("abc");
    expect(q.get("archived")).toBe("true");
  });

  it("omits archived when false (the API default)", () => {
    expect(buildProductsQuery({ archived: false }).has("archived")).toBe(false);
  });

  it("drops empty and whitespace-only values and trims the rest", () => {
    expect(
      buildProductsQuery({
        q: "  ",
        sku: " ",
        availability: "",
        categoryId: "",
        cursor: "",
      }).toString(),
    ).toBe("");
    expect(buildProductsQuery({ q: "  shirt " }).get("q")).toBe("shirt");
  });

  it("a name search suppresses sku, every filter, sort and dir", () => {
    const q = buildProductsQuery({
      q: "shirt",
      sku: "AB",
      availability: "active",
      categoryId: "c1",
      sort: "name",
      dir: "asc",
      archived: true,
    });
    expect(
      keys({
        q: "shirt",
        sku: "AB",
        availability: "active",
        categoryId: "c1",
        sort: "name",
        dir: "asc",
        archived: true,
      }),
    ).toEqual(["q", "archived"]);
    expect(q.get("q")).toBe("shirt");
  });

  it("a sku search suppresses filters, sort and dir when there is no name search", () => {
    expect(
      keys({
        sku: "tee-",
        availability: "draft",
        categoryId: "c1",
        sort: "createdAt",
        dir: "desc",
      }),
    ).toEqual(["sku"]);
  });

  it("keeps only one filter, availability before category", () => {
    expect(keys({ availability: "active", categoryId: "c1" })).toEqual(["availability"]);
    expect(keys({ availability: "", categoryId: "c1" })).toEqual(["categoryId"]);
  });

  it("keeps a filter when the search is blank", () => {
    expect(keys({ q: " ", sku: " ", availability: "draft" })).toEqual(["availability"]);
  });

  it("ignores a non-positive limit", () => {
    expect(buildProductsQuery({ limit: 0 }).has("limit")).toBe(false);
  });
});
