import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { normalizedIndexKey } from "@/lib/firestore-index-table";

import { ORDER_FILTER_FIELDS, ORDER_INDEXES, toFirestoreIndex } from "./order-indexes";

interface IndexJson {
  collectionGroup: string;
  queryScope: string;
  fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>;
}
const file = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../firestore.indexes.json"), "utf8"),
) as { indexes: IndexJson[] };
const ofGroup = (...groups: string[]) =>
  file.indexes.filter((i) => groups.includes(i.collectionGroup));
const canon = (i: unknown) => JSON.stringify(i);

describe("ORDER_INDEXES table", () => {
  it("has no duplicate entries, even once the implicit __name__ is dropped", () => {
    const keys = ORDER_INDEXES.map((s) => canon(toFirestoreIndex(s)));
    expect(new Set(keys).size).toBe(keys.length);
    const normalized = ORDER_INDEXES.map((s) => normalizedIndexKey(toFirestoreIndex(s)));
    expect(new Set(normalized).size).toBe(normalized.length);
  });

  it("every entry is present in firestore.indexes.json in the exact Firebase format", () => {
    const present = new Set(ofGroup("orders", "orderEvents").map(canon));
    for (const spec of ORDER_INDEXES) {
      expect(present.has(canon(toFirestoreIndex(spec))), JSON.stringify(spec)).toBe(true);
    }
  });

  it("firestore.indexes.json has no unlisted orders / orderEvents indexes", () => {
    const listed = new Set(ORDER_INDEXES.map((s) => canon(toFirestoreIndex(s))));
    const json = ofGroup("orders", "orderEvents");
    for (const index of json) expect(listed.has(canon(index)), canon(index)).toBe(true);
    expect(json).toHaveLength(ORDER_INDEXES.length);
  });

  it("__name__ is last, in the order field direction, after the order field (and any aggregate field)", () => {
    for (const spec of ORDER_INDEXES) {
      const { fields } = toFirestoreIndex(spec);
      expect(fields.at(-1)).toEqual({ fieldPath: "__name__", order: spec.direction });
      const trailing = spec.aggregateFields ?? [];
      expect(fields.at(-2 - trailing.length)).toEqual({
        fieldPath: spec.orderField,
        order: spec.direction,
      });
      expect(fields.slice(-1 - trailing.length, -1).map((f) => f.fieldPath)).toEqual([...trailing]);
      expect(spec.note.length).toBeGreaterThan(10);
    }
  });

  it("tenant list indexes start with organizationId", () => {
    for (const spec of ORDER_INDEXES.filter((s) => !s.crossOrg)) {
      expect(toFirestoreIndex(spec).fields[0]).toEqual({
        fieldPath: "organizationId",
        order: "ASCENDING",
      });
    }
  });

  it("serves the unfiltered list and every filterable field in both directions", () => {
    const serving = (filter: string | undefined, direction: string) =>
      ORDER_INDEXES.some(
        (s) =>
          s.collectionGroup === "orders" &&
          !s.crossOrg &&
          s.equalityFields.join() === (filter ? `organizationId,${filter}` : "organizationId") &&
          s.orderField === "createdAt" &&
          s.direction === direction,
      );
    for (const direction of ["ASCENDING", "DESCENDING"]) {
      expect(serving(undefined, direction), `unfiltered ${direction}`).toBe(true);
      for (const field of ORDER_FILTER_FIELDS) {
        expect(serving(field, direction), `${field} ${direction}`).toBe(true);
      }
    }
  });

  it("has the two expiry-sweep indexes and the order events timeline index", () => {
    const keys = ORDER_INDEXES.map((s) => canon(toFirestoreIndex(s)));
    const f = (fieldPath: string, order: string) => ({ fieldPath, order });
    const idx = (collectionGroup: string, ...fields: ReturnType<typeof f>[]) =>
      canon({ collectionGroup, queryScope: "COLLECTION", fields });
    expect(keys).toContain(
      idx(
        "orders",
        f("status", "ASCENDING"),
        f("holdExpiresAt", "ASCENDING"),
        f("__name__", "ASCENDING"),
      ),
    );
    expect(keys).toContain(
      idx(
        "orders",
        f("stockState", "ASCENDING"),
        f("updatedAt", "ASCENDING"),
        f("__name__", "ASCENDING"),
      ),
    );
    expect(keys).toContain(
      idx(
        "orderEvents",
        f("organizationId", "ASCENDING"),
        f("orderId", "ASCENDING"),
        f("createdAt", "ASCENDING"),
        f("__name__", "ASCENDING"),
      ),
    );
    expect(ORDER_INDEXES).toHaveLength(2 * 5 + 2 + 1 + 1);
  });

  it("has the dashboard revenue sum index: org, paymentStatus, createdAt, then the summed totalMinor", () => {
    const f = (fieldPath: string, order: string) => ({ fieldPath, order });
    expect(ORDER_INDEXES.map((s) => canon(toFirestoreIndex(s)))).toContain(
      canon({
        collectionGroup: "orders",
        queryScope: "COLLECTION",
        fields: [
          f("organizationId", "ASCENDING"),
          f("paymentStatus", "ASCENDING"),
          f("createdAt", "ASCENDING"),
          f("totalMinor", "ASCENDING"),
          f("__name__", "ASCENDING"),
        ],
      }),
    );
  });
});
