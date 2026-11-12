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
import { ORDER_INDEXES, toFirestoreIndex as toOrderIndex } from "@/services/orders/order-indexes";

import {
  COUNTED_ORDER_STATUSES,
  METRICS,
  REVENUE_PAYMENT_STATUSES,
  metricQueries,
  orderMetricQueries,
} from "./overview";

const ORG = "org-1";

describe("metricQueries", () => {
  it("scopes every metric to the organization", () => {
    for (const q of Object.values(metricQueries(ORG))) {
      expect(q.where[0]).toEqual(["organizationId", "==", ORG]);
    }
  });

  it("defines the four documented queries", () => {
    const q = metricQueries(ORG);
    expect(q.customers).toEqual({
      collection: "customers",
      where: [["organizationId", "==", ORG]],
    });
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
    expect(metricQueries(ORG).lowStock.where.slice(1)).toEqual(
      buildListPlan({ lowStock: true }).where,
    );
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

describe("order metrics", () => {
  const NOW = new Date("2026-11-12T06:00:00Z"); // 12:00 on 12 Nov in Dhaka
  const DAY = new Date("2026-11-11T18:00:00Z");
  const MONTH = new Date("2026-10-31T18:00:00Z");

  it("lists the metrics, orders last", () => {
    expect([...METRICS]).toEqual([
      "customers",
      "leads",
      "products",
      "lowStock",
      "ordersToday",
      "revenueMonthMinor",
    ]);
  });

  it("counts every status except draft and cancelled, and revenue is paid + COD collected", () => {
    expect([...COUNTED_ORDER_STATUSES]).toEqual([
      "confirmed",
      "processing",
      "shipped",
      "delivered",
      "returned",
    ]);
    expect([...REVENUE_PAYMENT_STATUSES]).toEqual(["paid", "cod_collected"]);
  });

  it("ordersToday is one query per counted status since Dhaka midnight", () => {
    const { ordersToday } = orderMetricQueries(ORG, NOW);
    expect(ordersToday.map((q) => q.where)).toEqual(
      COUNTED_ORDER_STATUSES.map((status) => [
        ["organizationId", "==", ORG],
        ["status", "==", status],
        ["createdAt", ">=", DAY],
      ]),
    );
    expect(new Set(ordersToday.map((q) => q.collection))).toEqual(new Set(["orders"]));
  });

  it("revenueMonthMinor is one query per payment status since the first of the Dhaka month", () => {
    const { revenueMonth } = orderMetricQueries(ORG, NOW);
    expect(revenueMonth.map((q) => q.where)).toEqual(
      REVENUE_PAYMENT_STATUSES.map((paymentStatus) => [
        ["organizationId", "==", ORG],
        ["paymentStatus", "==", paymentStatus],
        ["createdAt", ">=", MONTH],
      ]),
    );
  });

  it("both shapes are served by existing (organizationId, filter, createdAt) order indexes", () => {
    const served = (field: string) =>
      ORDER_INDEXES.filter(
        (s) =>
          s.collectionGroup === "orders" &&
          !s.crossOrg &&
          s.orderField === "createdAt" &&
          s.equalityFields.join() === `organizationId,${field}`,
      ).map((s) =>
        toOrderIndex(s)
          .fields.map((f) => f.fieldPath)
          .join(),
      );
    for (const field of ["status", "paymentStatus"]) {
      expect(served(field)).toContain(`organizationId,${field},createdAt,__name__`);
    }
  });

  it("the revenue sum has an index that carries the summed field", () => {
    const sums = ORDER_INDEXES.filter((s) => s.aggregateFields?.includes("totalMinor")).map((s) =>
      toOrderIndex(s)
        .fields.map((f) => f.fieldPath)
        .join(),
    );
    expect(sums).toEqual(["organizationId,paymentStatus,createdAt,totalMinor,__name__"]);
  });
});
