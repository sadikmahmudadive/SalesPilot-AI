import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CUSTOMER_LIST_INDEXES,
  toFirestoreIndex as toCustomerIndex,
} from "@/services/crm/customer-indexes";
import {
  PRODUCT_LIST_INDEXES,
  toFirestoreIndex as toProductIndex,
} from "@/services/products/product-indexes";

import { INVENTORY_LIST_INDEXES, indexServing, toFirestoreIndex } from "./inventory-indexes";
import { buildListPlan, type InventoryListQuery } from "./inventory-query";

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

describe("INVENTORY_LIST_INDEXES table", () => {
  it("has no duplicate entries", () => {
    const keys = INVENTORY_LIST_INDEXES.map((s) => canon(toFirestoreIndex(s)));
    expect(new Set(keys).size).toBe(keys.length);
    expect(INVENTORY_LIST_INDEXES).toHaveLength(4);
  });

  it("equals the inventory entries of firestore.indexes.json exactly (none missing, none extra)", () => {
    const table = INVENTORY_LIST_INDEXES.map((s) => canon(toFirestoreIndex(s))).sort();
    expect(of("inventory").map(canon).sort()).toEqual(table);
  });

  it("every index starts with organizationId and keeps __name__ in the order direction", () => {
    for (const spec of INVENTORY_LIST_INDEXES) {
      const { fields } = toFirestoreIndex(spec);
      expect(fields[0]).toEqual({ fieldPath: "organizationId", order: "ASCENDING" });
      if (spec.withName) {
        expect(fields.at(-1)).toEqual({ fieldPath: "__name__", order: fields.at(-2)!.order });
      }
      expect(spec.note.length).toBeGreaterThan(10);
    }
  });

  it("serves every list query the service can issue", () => {
    const shapes: InventoryListQuery[] = [
      {},
      { limit: 10 },
      { cursor: "abc" },
      { lowStock: false },
      { lowStock: true },
      { lowStock: true, cursor: "abc", limit: 50 },
      { productId: "p1" },
      { productId: "p1", lowStock: false },
      { productId: "p1", cursor: "abc" },
    ];
    for (const q of shapes) {
      const plan = buildListPlan(q);
      const spec = indexServing(plan.shape);
      expect(spec, JSON.stringify(q)).toBeDefined();
      // The index field order matches the query: where fields, then the order field + __name__.
      const idx = toFirestoreIndex(spec!).fields.map((f) => f.fieldPath);
      const wanted = [
        "organizationId",
        ...plan.where.map((w) => w[0]),
        plan.orderBy[0],
        "__name__",
      ];
      expect(idx).toEqual([...new Set(wanted)]);
      const dir = plan.orderBy[1] === "asc" ? "ASCENDING" : "DESCENDING";
      expect(toFirestoreIndex(spec!).fields.at(-1)!.order).toBe(dir);
    }
  });

  it("includes the organization + available shape of the low-stock count query", () => {
    expect(of("inventory").map(canon)).toContain(
      canon({
        collectionGroup: "inventory",
        queryScope: "COLLECTION",
        fields: [
          { fieldPath: "organizationId", order: "ASCENDING" },
          { fieldPath: "available", order: "ASCENDING" },
        ],
      }),
    );
  });
});

describe("other collections in firestore.indexes.json", () => {
  it("leaves the customers and products indexes untouched", () => {
    expect(of("customers").map(canon).sort()).toEqual(
      CUSTOMER_LIST_INDEXES.map((s) => canon(toCustomerIndex(s))).sort(),
    );
    expect(of("products").map(canon).sort()).toEqual(
      PRODUCT_LIST_INDEXES.map((s) => canon(toProductIndex(s))).sort(),
    );
    expect(of("customers")).toHaveLength(31);
    expect(of("products")).toHaveLength(19);
  });
});
