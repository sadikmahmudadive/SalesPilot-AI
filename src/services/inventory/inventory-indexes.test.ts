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

import { normalizedIndexKey } from "@/lib/firestore-index-table";
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
    expect(INVENTORY_LIST_INDEXES).toHaveLength(3);
  });

  it("no two inventory entries (table or JSON) are the same index once the implicit __name__ is dropped", () => {
    const tableKeys = INVENTORY_LIST_INDEXES.map((spec) =>
      normalizedIndexKey(toFirestoreIndex(spec)),
    );
    expect(new Set(tableKeys).size).toBe(tableKeys.length);
    const jsonKeys = of("inventory").map((i) =>
      normalizedIndexKey(i as unknown as Parameters<typeof normalizedIndexKey>[0]),
    );
    expect(new Set(jsonKeys).size).toBe(jsonKeys.length);
  });

  it("normalizedIndexKey treats a trailing same-direction __name__ as implicit", () => {
    const f = (fieldPath: string, order: "ASCENDING" | "DESCENDING") => ({ fieldPath, order });
    const mk = (...fields: ReturnType<typeof f>[]) => ({
      collectionGroup: "inventory",
      queryScope: "COLLECTION" as const,
      fields,
    });
    const a = mk(f("organizationId", "ASCENDING"), f("available", "ASCENDING"));
    const b = mk(
      f("organizationId", "ASCENDING"),
      f("available", "ASCENDING"),
      f("__name__", "ASCENDING"),
    );
    const c = mk(
      f("organizationId", "ASCENDING"),
      f("available", "ASCENDING"),
      f("__name__", "DESCENDING"),
    );
    expect(normalizedIndexKey(a)).toBe(normalizedIndexKey(b));
    expect(normalizedIndexKey(a)).not.toBe(normalizedIndexKey(c));
  });

  it("equals the inventory entries of firestore.indexes.json exactly (none missing, none extra)", () => {
    const table = INVENTORY_LIST_INDEXES.map((s) => canon(toFirestoreIndex(s))).sort();
    expect(of("inventory").map(canon).sort()).toEqual(table);
  });

  it("every index starts with organizationId and keeps __name__ in the order direction", () => {
    for (const spec of INVENTORY_LIST_INDEXES) {
      const { fields } = toFirestoreIndex(spec);
      expect(fields[0]).toEqual({ fieldPath: "organizationId", order: "ASCENDING" });
      expect(fields.at(-1)).toEqual({ fieldPath: "__name__", order: fields.at(-2)!.order });
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

  it("the lowStock entry also serves the overview count (organizationId == org AND available <= N)", () => {
    const spec = indexServing("lowStock")!;
    expect(toFirestoreIndex(spec).fields).toEqual([
      { fieldPath: "organizationId", order: "ASCENDING" },
      { fieldPath: "available", order: "ASCENDING" },
      { fieldPath: "__name__", order: "ASCENDING" },
    ]);
    expect(spec.note).toMatch(/count/i);
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
