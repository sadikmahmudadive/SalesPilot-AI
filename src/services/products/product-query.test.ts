import { describe, expect, it } from "vitest";

import { PREFIX_END } from "@/lib/text";
import { ValidationError } from "@/lib/errors";

import { MAX_SEARCH_LENGTH, buildListPlan, parseListParams, skuLowerKey } from "./product-query";

const BN = String.fromCodePoint(0x09b6, 0x09be, 0x09a1, 0x09bc, 0x09bf);
const q = (extra: Record<string, unknown> = {}) => ({
  sort: "createdAt" as const,
  dir: "desc" as const,
  ...extra,
});
const params = (s: string) => parseListParams(new URLSearchParams(s));

describe("buildListPlan", () => {
  it("always filters on archived == false by default", () => {
    const plan = buildListPlan(q());
    expect(plan.where).toEqual([["archived", "==", false]]);
    expect(plan.orderBy).toEqual(["createdAt", "desc"]);
    expect(plan.limit).toBe(25);
  });
  it("archived=true flips the clause", () => {
    expect(buildListPlan(q({ archived: true })).where).toEqual([["archived", "==", true]]);
  });
  it("maps sort names to stored fields", () => {
    expect(buildListPlan(q({ sort: "name", dir: "asc" })).orderBy).toEqual(["nameLower", "asc"]);
    expect(buildListPlan(q({ sort: "updatedAt" })).orderBy).toEqual(["updatedAt", "desc"]);
  });
  it("one filter is allowed, two are not", () => {
    expect(buildListPlan(q({ availability: "active" })).where).toEqual([
      ["archived", "==", false],
      ["availability", "==", "active"],
    ]);
    expect(buildListPlan(q({ categoryId: "c1" })).shape.filterField).toBe("categoryId");
    expect(() => buildListPlan(q({ availability: "active", categoryId: "c1" }))).toThrow(
      ValidationError,
    );
  });
  it("name search is a prefix range on nameLower, ascending, ignoring sort", () => {
    const plan = buildListPlan(q({ q: "  Cot  Ton ", sort: "updatedAt", dir: "desc" }));
    expect(plan.where).toEqual([
      ["archived", "==", false],
      ["nameLower", ">=", "cot ton"],
      ["nameLower", "<", `cot ton${PREFIX_END}`],
    ]);
    expect(plan.orderBy).toEqual(["nameLower", "asc"]);
  });
  it("name search handles Bangla", () => {
    expect(buildListPlan(q({ q: BN })).where[1]).toEqual(["nameLower", ">=", BN]);
  });
  it("sku search is a lower-cased prefix range on skuLower", () => {
    const plan = buildListPlan(q({ sku: " SH-0 " }));
    expect(plan.where.slice(1)).toEqual([
      ["skuLower", ">=", "sh-0"],
      ["skuLower", "<", `sh-0${PREFIX_END}`],
    ]);
    expect(plan.orderBy).toEqual(["skuLower", "asc"]);
  });
  it("search cannot be combined with a filter or with the other search", () => {
    expect(() => buildListPlan(q({ q: "a", availability: "draft" }))).toThrow(ValidationError);
    expect(() => buildListPlan(q({ sku: "a", categoryId: "c" }))).toThrow(ValidationError);
    expect(() => buildListPlan(q({ q: "a", sku: "b" }))).toThrow(ValidationError);
  });
  it("blank search is ignored; over-long, lone-surrogate and bad-charset searches are rejected", () => {
    expect(buildListPlan(q({ q: "   " })).orderBy[0]).toBe("createdAt");
    expect(() => buildListPlan(q({ q: "a".repeat(MAX_SEARCH_LENGTH + 1) }))).toThrow(
      ValidationError,
    );
    expect(() => buildListPlan(q({ q: "a\uD800" }))).toThrow(ValidationError);
    expect(() => buildListPlan(q({ sku: "a b" }))).toThrow(ValidationError);
    expect(() => buildListPlan(q({ sku: "a/b" }))).toThrow(ValidationError);
  });
  it("validates limit, sort, dir, enums and ids", () => {
    expect(() => buildListPlan(q({ limit: 0 }))).toThrow(ValidationError);
    expect(() => buildListPlan(q({ limit: 51 }))).toThrow(ValidationError);
    expect(buildListPlan(q({ limit: 50 })).limit).toBe(50);
    expect(() => buildListPlan(q({ sort: "price" }))).toThrow(ValidationError);
    expect(() => buildListPlan(q({ dir: "up" }))).toThrow(ValidationError);
    expect(() => buildListPlan(q({ availability: "sold" }))).toThrow(ValidationError);
    expect(() => buildListPlan(q({ categoryId: "a/b" }))).toThrow(ValidationError);
    expect(() => buildListPlan(q({ archived: "yes" }))).toThrow(ValidationError);
  });
  it("error messages never echo the input", () => {
    try {
      buildListPlan(q({ sku: "secret value" }));
    } catch (err) {
      expect(JSON.stringify((err as ValidationError).details)).not.toContain("secret");
    }
  });
});

describe("skuLowerKey", () => {
  it("lower-cases", () => expect(skuLowerKey("AB-1.X")).toBe("ab-1.x"));
});

describe("parseListParams", () => {
  it("defaults to createdAt desc; name sort defaults to asc", () => {
    expect(params("")).toEqual({ sort: "createdAt", dir: "desc" });
    expect(params("sort=name")).toEqual({ sort: "name", dir: "asc" });
    expect(params("sort=name&dir=desc").dir).toBe("desc");
  });
  it("parses every parameter", () => {
    expect(params("q=shi&availability=active&archived=true&limit=10&cursor=abc")).toEqual({
      sort: "createdAt",
      dir: "desc",
      q: "shi",
      availability: "active",
      archived: true,
      limit: 10,
      cursor: "abc",
    });
    expect(params("sku=ab&categoryId=c1").sku).toBe("ab");
    expect(params("archived=false").archived).toBe(false);
  });
  it("ignores unknown params and treats empty values as absent", () => {
    expect(params("foo=1&q=&archived=")).toEqual({ sort: "createdAt", dir: "desc" });
  });
  it("rejects repeated params", () => {
    expect(() => params("q=a&q=b")).toThrow(ValidationError);
    expect(() => params("archived=true&archived=false")).toThrow(ValidationError);
  });
  it("rejects invalid values", () => {
    for (const s of [
      "archived=yes",
      "archived=1",
      "limit=0",
      "limit=51",
      "limit=abc",
      "sort=price",
      "availability=x",
      "categoryId=a/b",
      `q=${"a".repeat(65)}`,
    ]) {
      expect(() => params(s), s).toThrow(ValidationError);
    }
  });
});
