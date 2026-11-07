import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTERS,
  hasActiveCriteria,
  searchTerm,
  toListParams,
  type ProductFilterState,
} from "@/components/products/list-params";

const state = (patch: Partial<ProductFilterState>): ProductFilterState => ({
  ...DEFAULT_FILTERS,
  ...patch,
});

describe("toListParams", () => {
  it("maps each sort option to sort and dir", () => {
    expect(toListParams(state({ sortKey: "newest" }))).toMatchObject({
      sort: "createdAt",
      dir: "desc",
    });
    expect(toListParams(state({ sortKey: "name-asc" }))).toMatchObject({
      sort: "name",
      dir: "asc",
    });
    expect(toListParams(state({ sortKey: "name-desc" }))).toMatchObject({
      sort: "name",
      dir: "desc",
    });
    expect(toListParams(state({ sortKey: "updated" }))).toMatchObject({
      sort: "updatedAt",
      dir: "desc",
    });
  });

  it("always sets a page size", () => {
    expect(toListParams(DEFAULT_FILTERS).limit).toBe(25);
  });

  it("ignores a search shorter than two characters", () => {
    expect(toListParams(state({ search: "a" })).q).toBeUndefined();
    expect(toListParams(state({ search: " a ", searchMode: "sku" })).sku).toBeUndefined();
  });

  it("searches by name or by SKU depending on the mode, trimmed", () => {
    expect(toListParams(state({ search: "  shirt " })).q).toBe("shirt");
    const p = toListParams(state({ search: " tee-", searchMode: "sku" }));
    expect(p.sku).toBe("tee-");
    expect(p.q).toBeUndefined();
  });

  it("drops filters while a search is active (one criterion at a time)", () => {
    const p = toListParams(
      state({ search: "shirt", filterBy: "availability", availability: "active" }),
    );
    expect(p.q).toBe("shirt");
    expect(p.availability).toBeUndefined();
    expect(p.categoryId).toBeUndefined();
  });

  it("sends the one chosen filter", () => {
    expect(
      toListParams(state({ filterBy: "availability", availability: "draft" })).availability,
    ).toBe("draft");
    expect(toListParams(state({ filterBy: "category", categoryId: "c1" })).categoryId).toBe("c1");
    // A stale value of the other filter is not sent.
    expect(
      toListParams(state({ filterBy: "category", categoryId: "c1", availability: "draft" }))
        .availability,
    ).toBeUndefined();
  });

  it("sends nothing for a filter without a value", () => {
    const p = toListParams(state({ filterBy: "availability", availability: "" }));
    expect(p.availability).toBeUndefined();
  });

  it("asks for archived products, which cannot also be filtered by availability", () => {
    expect(toListParams(state({ archived: true })).archived).toBe(true);
    expect(toListParams(state({ archived: false })).archived).toBe(false);
    expect(
      toListParams(state({ archived: true, filterBy: "availability", availability: "active" }))
        .availability,
    ).toBeUndefined();
    expect(
      toListParams(state({ archived: true, filterBy: "category", categoryId: "c1" })).categoryId,
    ).toBe("c1");
  });
});

describe("SKU search sanitising", () => {
  const sku = (search: string) => toListParams(state({ search, searchMode: "sku" })).sku;

  it("strips characters a SKU cannot contain, so the API never answers 400", () => {
    expect(sku("TEE 1")).toBe("TEE1");
    expect(sku(" tee-01 ")).toBe("tee-01");
    expect(sku("a/b#c")).toBe("abc");
    expect(sku("ts_1.2")).toBe("ts_1.2");
  });

  it("does not search when nothing usable is left", () => {
    expect(sku("  ")).toBeUndefined();
    expect(sku("@@")).toBeUndefined();
    expect(sku("a@")).toBeUndefined();
    expect(hasActiveCriteria(state({ search: "@@", searchMode: "sku" }))).toBe(false);
  });

  it("leaves a name search alone", () => {
    expect(toListParams(state({ search: "red shirt #2" })).q).toBe("red shirt #2");
  });

  it("searchTerm is empty exactly when no search runs", () => {
    expect(searchTerm({ search: "ab", searchMode: "name" })).toBe("ab");
    expect(searchTerm({ search: "a b", searchMode: "sku" })).toBe("ab");
    expect(searchTerm({ search: "a", searchMode: "name" })).toBe("");
  });
});

describe("hasActiveCriteria", () => {
  it("is false for the defaults and for sorting alone", () => {
    expect(hasActiveCriteria(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveCriteria(state({ sortKey: "name-asc" }))).toBe(false);
  });

  it("is true for a search, a filter value or the archived view", () => {
    expect(hasActiveCriteria(state({ search: "shirt" }))).toBe(true);
    expect(hasActiveCriteria(state({ filterBy: "category", categoryId: "c1" }))).toBe(true);
    expect(hasActiveCriteria(state({ archived: true }))).toBe(true);
  });

  it("ignores a too-short search and an empty filter", () => {
    expect(hasActiveCriteria(state({ search: "a" }))).toBe(false);
    expect(hasActiveCriteria(state({ filterBy: "availability", availability: "" }))).toBe(false);
  });
});
