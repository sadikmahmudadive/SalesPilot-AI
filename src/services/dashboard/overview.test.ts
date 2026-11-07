import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LOW_STOCK_THRESHOLD } from "@/config/inventory";
import { normalizedIndexKey } from "@/lib/firestore-index-table";
import { buildListPlan } from "@/services/inventory/inventory-query";
import {
  INVENTORY_LIST_INDEXES,
  indexServing,
  toFirestoreIndex,
} from "@/services/inventory/inventory-indexes";

import { LEAD_SEGMENTS } from "./lead-segments";
import { metricQueries } from "./overview";

const ORG = "org-1";

describe("metricQueries", () => {
  it("scopes every metric to the organization", () => {
    for (const q of Object.values(metricQueries(ORG))) {
      expect(q.where[0]).toEqual(["organizationId", "==", ORG]);
    }
  });

  it("defines the four documented queries", () => {
    const q = metricQueries(ORG);
    expect(q.customers).toEqual({ collection: "customers", where: [["organizationId", "==", ORG]] });
    expect(q.leads).toEqual({
      collection: "customers",
      where: [
        ["organizationId", "==", ORG],
        ["segment", "in", [...LEAD_SEGMENTS]],
      ],
    });
    expect(q.products).toEqual({
      collection: "products",
      where: [
        ["organizationId", "==", ORG],
        ["archived", "==", false],
      ],
    });
    expect(q.lowStock).toEqual({
      collection: "inventory",
      where: [
        ["organizationId", "==", ORG],
        ["available", "<=", LOW_STOCK_THRESHOLD],
      ],
    });
  });

  it("uses the same low-stock predicate as the inventory list", () => {
    expect(metricQueries(ORG).lowStock.where.slice(1)).toEqual(buildListPlan({ lowStock: true }).where);
  });
});

describe("low-stock count index", () => {
  const file = JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "../../../firestore.indexes.json"), "utf8"),
  ) as { indexes: Array<{ collectionGroup: string; queryScope: string; fields: unknown[] }> };

  it("is served by the inventory [organizationId ASC, available ASC] index", () => {
    const spec = indexServing("lowStock");
    expect(spec).toBeDefined();
    expect(INVENTORY_LIST_INDEXES).toContain(spec);
    expect(toFirestoreIndex(spec!).fields).toEqual([
      { fieldPath: "organizationId", order: "ASCENDING" },
      { fieldPath: "available", order: "ASCENDING" },
      { fieldPath: "__name__", order: "ASCENDING" },
    ]);
  });

  it("is deployed in firestore.indexes.json", () => {
    const wanted = normalizedIndexKey(toFirestoreIndex(indexServing("lowStock")!));
    const deployed = file.indexes
      .filter((i) => i.collectionGroup === "inventory")
      .map((i) => normalizedIndexKey(i as Parameters<typeof normalizedIndexKey>[0]));
    expect(deployed).toContain(wanted);
  });
});
