import { describe, expect, it } from "vitest";

import { LOW_STOCK_THRESHOLD } from "@/config/inventory";
import { ValidationError } from "@/lib/errors";

import { buildListPlan, parseListParams, variantLabelOf } from "./inventory-query";

const params = (s: string) => parseListParams(new URLSearchParams(s));

describe("buildListPlan", () => {
  it("defaults to updatedAt desc, no filter, limit 25", () => {
    const plan = buildListPlan({});
    expect(plan).toMatchObject({
      where: [],
      orderBy: ["updatedAt", "desc"],
      limit: 25,
      shape: "default",
    });
  });
  it("productId filters and sorts by variantId ascending", () => {
    const plan = buildListPlan({ productId: "p1" });
    expect(plan.where).toEqual([["productId", "==", "p1"]]);
    expect(plan.orderBy).toEqual(["variantId", "asc"]);
    expect(plan.shape).toBe("byProduct");
  });
  it("lowStock uses available <= threshold ordered by available ascending", () => {
    const plan = buildListPlan({ lowStock: true });
    expect(plan.where).toEqual([["available", "<=", LOW_STOCK_THRESHOLD]]);
    expect(plan.orderBy).toEqual(["available", "asc"]);
    expect(plan.shape).toBe("lowStock");
    expect(LOW_STOCK_THRESHOLD).toBe(5);
  });
  it("lowStock=false is the same as absent", () => {
    expect(buildListPlan({ lowStock: false }).shape).toBe("default");
    expect(buildListPlan({ lowStock: false, productId: "p1" }).shape).toBe("byProduct");
  });
  it("productId and lowStock=true cannot be combined", () => {
    expect(() => buildListPlan({ productId: "p1", lowStock: true })).toThrow(ValidationError);
  });
  it("rejects bad limits and ids", () => {
    for (const limit of [0, 51, 1.5, Number.NaN]) {
      expect(() => buildListPlan({ limit })).toThrow(ValidationError);
    }
    for (const productId of ["", "a/b", "..", "__x__"]) {
      expect(() => buildListPlan({ productId })).toThrow(ValidationError);
    }
  });
});

describe("parseListParams", () => {
  it("parses all params and treats empty values as absent", () => {
    expect(params("productId=p1&limit=10&cursor=abc")).toEqual({
      productId: "p1",
      limit: 10,
      cursor: "abc",
    });
    expect(params("lowStock=true")).toEqual({ lowStock: true });
    expect(params("lowStock=false")).toEqual({ lowStock: false });
    expect(params("productId=&lowStock=&limit=")).toEqual({});
  });
  it("rejects invalid and repeated values, ignores unknown params", () => {
    expect(() => params("lowStock=yes")).toThrow(ValidationError);
    expect(() => params("lowStock=1")).toThrow(ValidationError);
    expect(() => params("limit=0")).toThrow(ValidationError);
    expect(() => params("limit=51")).toThrow(ValidationError);
    expect(() => params("productId=a%2Fb")).toThrow(ValidationError);
    expect(() => params("productId=a&productId=b")).toThrow(ValidationError);
    expect(params("sort=name&org=x")).toEqual({});
  });
});

describe("variantLabelOf", () => {
  const variants = [
    { id: "v1", size: "M", color: "Red" },
    { id: "v2", size: "L" },
    { id: "v3", color: "Blue" },
  ];
  it("joins size and color, or says Default", () => {
    expect(variantLabelOf("v1", variants)).toBe("M / Red");
    expect(variantLabelOf("v2", variants)).toBe("L");
    expect(variantLabelOf("v3", variants)).toBe("Blue");
    expect(variantLabelOf("default", variants)).toBe("Default");
    expect(variantLabelOf("gone", variants)).toBe("Default");
    expect(variantLabelOf("v1", undefined)).toBe("Default");
  });
});
