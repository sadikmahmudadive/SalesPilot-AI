import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CUSTOMER_LIST_INDEXES,
  toFirestoreIndex as toCustomerIndex,
} from "@/services/crm/customer-indexes";
import { AVAILABILITIES } from "@/schemas/product";

import {
  CATEGORY_LIST_INDEX,
  PRODUCT_LIST_INDEXES,
  indexServing,
  toFirestoreIndex,
} from "./product-indexes";
import { buildListPlan, type ProductListQuery } from "./product-query";

interface IndexJson {
  collectionGroup: string;
  queryScope: string;
  fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>;
}
const file = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../firestore.indexes.json"), "utf8"),
) as { indexes: IndexJson[] };
const of = (group: string) => file.indexes.filter((i) => i.collectionGroup === group);
const canon = (i: unknown) => JSON.stringify(i);

describe("PRODUCT_LIST_INDEXES table", () => {
  it("has no duplicate entries and 19 entries", () => {
    const keys = PRODUCT_LIST_INDEXES.map(
      (s) => `${s.equalityField ?? ""}|${s.orderField}|${s.direction}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(PRODUCT_LIST_INDEXES).toHaveLength(19);
  });

  it("equals the products entries of firestore.indexes.json exactly (none missing, none extra)", () => {
    const table = PRODUCT_LIST_INDEXES.map((s) => canon(toFirestoreIndex(s))).sort();
    const json = of("products").map(canon).sort();
    expect(json).toEqual(table);
  });

  it("every index starts with organizationId, archived and ends with __name__", () => {
    for (const spec of PRODUCT_LIST_INDEXES) {
      const { fields } = toFirestoreIndex(spec);
      expect(fields[0]).toEqual({ fieldPath: "organizationId", order: "ASCENDING" });
      expect(fields[1]).toEqual({ fieldPath: "archived", order: "ASCENDING" });
      expect(fields.at(-1)).toEqual({ fieldPath: "__name__", order: spec.direction });
      expect(fields.at(-2)).toEqual({ fieldPath: spec.orderField, order: spec.direction });
      expect(spec.note.length).toBeGreaterThan(10);
    }
  });

  it("every (filter, order field) pair has both directions, except the ascending-only SKU search", () => {
    const pairs = new Map<string, Set<string>>();
    for (const s of PRODUCT_LIST_INDEXES) {
      const key = `${s.equalityField ?? ""}|${s.orderField}`;
      pairs.set(key, (pairs.get(key) ?? new Set()).add(s.direction));
    }
    for (const [key, dirs] of pairs) {
      if (key === "|skuLower") expect([...dirs]).toEqual(["ASCENDING"]);
      else expect([...dirs].sort(), key).toEqual(["ASCENDING", "DESCENDING"]);
    }
  });

  it("serves every query the service can issue (filters x sorts x directions x archived, and both searches)", () => {
    const shapes: ProductListQuery[] = [];
    for (const sort of ["createdAt", "name", "updatedAt"] as const) {
      for (const dir of ["asc", "desc"] as const) {
        for (const archived of [undefined, false, true]) {
          const b = { sort, dir, archived };
          shapes.push(
            b,
            { ...b, categoryId: "cat1" },
            ...AVAILABILITIES.map((availability) => ({ ...b, availability })),
          );
        }
      }
    }
    shapes.push(
      { sort: "createdAt", dir: "desc", q: "shi" },
      { sort: "name", dir: "desc", q: "shi", archived: true },
      { sort: "createdAt", dir: "desc", sku: "SH-0" },
    );
    for (const q of shapes) {
      const plan = buildListPlan(q);
      expect(indexServing(plan.shape), JSON.stringify(plan.shape)).toBeDefined();
    }
  });

  it("indexServing needs the matching direction and does not invent shapes", () => {
    expect(indexServing({ orderField: "skuLower", direction: "asc" })).toBeDefined();
    expect(indexServing({ orderField: "skuLower", direction: "desc" })).toBeUndefined();
    expect(
      indexServing({ filterField: "availability", orderField: "skuLower", direction: "asc" }),
    ).toBeUndefined();
  });
});

describe("other collections in firestore.indexes.json", () => {
  it("leaves the customers indexes untouched", () => {
    const table = CUSTOMER_LIST_INDEXES.map((s) => canon(toCustomerIndex(s))).sort();
    expect(of("customers").map(canon).sort()).toEqual(table);
    expect(of("customers")).toHaveLength(31);
  });

  it("holds exactly the category list index (and no other collection group but inventory)", () => {
    expect(of("categories").map(canon)).toEqual([canon(CATEGORY_LIST_INDEX)]);
    const groups = new Set(file.indexes.map((i) => i.collectionGroup));
    expect([...groups].sort()).toEqual(["categories", "customers", "inventory", "products"]);
  });
});
