import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CUSTOMER_LIST_INDEXES,
  toFirestoreIndex as toCustomerIndex,
} from "@/services/crm/customer-indexes";
import {
  CATEGORY_LIST_INDEX,
  PRODUCT_LIST_INDEXES,
  toFirestoreIndex as toProductIndex,
} from "@/services/products/product-indexes";

import { AGENT_LIST_INDEXES, toFirestoreIndex } from "./agent-indexes";

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

describe("AGENT_LIST_INDEXES table", () => {
  it("has exactly the agents and agentSessions indexes", () => {
    expect(AGENT_LIST_INDEXES.map((s) => s.collectionGroup).sort()).toEqual([
      "agentSessions",
      "agents",
    ]);
    for (const spec of AGENT_LIST_INDEXES) expect(spec.note.length).toBeGreaterThan(10);
  });

  it("starts with organizationId and ends with __name__ in the order field direction", () => {
    for (const spec of AGENT_LIST_INDEXES) {
      const { fields } = toFirestoreIndex(spec);
      expect(fields[0]).toEqual({ fieldPath: "organizationId", order: "ASCENDING" });
      expect(fields.at(-1)?.fieldPath).toBe("__name__");
      expect(fields.at(-1)?.order).toBe(fields.at(-2)?.order);
    }
  });

  it("equals the agents and agentSessions entries of firestore.indexes.json exactly", () => {
    const table = AGENT_LIST_INDEXES.map((s) => canon(toFirestoreIndex(s))).sort();
    const json = [...of("agents"), ...of("agentSessions")].map(canon).sort();
    expect(json).toEqual(table);
  });
});

describe("other collections in firestore.indexes.json", () => {
  it("leaves customers, products and categories untouched", () => {
    expect(of("customers").map(canon).sort()).toEqual(
      CUSTOMER_LIST_INDEXES.map((s) => canon(toCustomerIndex(s))).sort(),
    );
    expect(of("products").map(canon).sort()).toEqual(
      PRODUCT_LIST_INDEXES.map((s) => canon(toProductIndex(s))).sort(),
    );
    expect(of("categories").map(canon)).toEqual([canon(CATEGORY_LIST_INDEX)]);
  });

  it("holds no other collection groups", () => {
    const groups = new Set(file.indexes.map((i) => i.collectionGroup));
    expect([...groups].sort()).toEqual([
      "agentSessions",
      "agents",
      "categories",
      "customers",
      "inventory",
      "products",
    ]);
  });
});
