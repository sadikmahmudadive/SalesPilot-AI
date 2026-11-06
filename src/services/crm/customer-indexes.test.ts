import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CUSTOMER_SEGMENTS, CUSTOMER_TYPES } from "@/schemas/customer";

import {
  CUSTOMER_LIST_INDEXES,
  indexServing,
  toFirestoreIndex,
  type CustomerIndexSpec,
} from "./customer-indexes";
import { buildListPlan } from "./customer-query";

interface IndexJson {
  collectionGroup: string;
  queryScope: string;
  fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>;
}
const file = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../firestore.indexes.json"), "utf8"),
) as {
  indexes: IndexJson[];
};
const customerIndexes = file.indexes.filter((i) => i.collectionGroup === "customers");
const canon = (i: unknown) => JSON.stringify(i);

describe("CUSTOMER_LIST_INDEXES table", () => {
  it("has no duplicate entries", () => {
    const keys = CUSTOMER_LIST_INDEXES.map(
      (s) =>
        `${s.equalityField ?? ""}|${s.arrayContainsField ?? ""}|${s.orderField}|${s.direction}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every entry is present in firestore.indexes.json in the exact Firebase format", () => {
    const present = new Set(customerIndexes.map(canon));
    for (const spec of CUSTOMER_LIST_INDEXES) {
      expect(present.has(canon(toFirestoreIndex(spec))), JSON.stringify(spec)).toBe(true);
    }
  });

  it("firestore.indexes.json has no unlisted customers indexes", () => {
    const listed = new Set(CUSTOMER_LIST_INDEXES.map((s) => canon(toFirestoreIndex(s))));
    for (const index of customerIndexes) expect(listed.has(canon(index)), canon(index)).toBe(true);
    expect(customerIndexes).toHaveLength(CUSTOMER_LIST_INDEXES.length);
  });

  it("every index starts with organizationId and ends with __name__", () => {
    for (const spec of CUSTOMER_LIST_INDEXES) {
      const { fields } = toFirestoreIndex(spec);
      expect(fields[0]).toEqual({ fieldPath: "organizationId", order: "ASCENDING" });
      expect(fields.at(-1)?.fieldPath).toBe("__name__");
      expect(spec.note.length).toBeGreaterThan(10);
    }
  });

  it("array-contains uses arrayConfig CONTAINS", () => {
    const tags = CUSTOMER_LIST_INDEXES.filter((s) => s.arrayContainsField === "tagsLower");
    expect(tags.length).toBeGreaterThan(0);
    for (const spec of tags) {
      expect(toFirestoreIndex(spec).fields).toContainEqual({
        fieldPath: "tagsLower",
        arrayConfig: "CONTAINS",
      });
    }
  });

  it("every (filter, order field) pair has both directions, except the ascending-only phone search", () => {
    const pairs = new Map<string, Set<string>>();
    for (const s of CUSTOMER_LIST_INDEXES) {
      const key = `${s.equalityField ?? ""}|${s.arrayContainsField ?? ""}|${s.orderField}`;
      pairs.set(key, (pairs.get(key) ?? new Set()).add(s.direction));
    }
    for (const [key, dirs] of pairs) {
      if (key === "||phoneE164") expect([...dirs]).toEqual(["ASCENDING"]);
      else expect([...dirs].sort(), key).toEqual(["ASCENDING", "DESCENDING"]);
    }
    expect(CUSTOMER_LIST_INDEXES).toHaveLength(31);
  });

  it("__name__ always follows the order field in the same direction", () => {
    for (const spec of CUSTOMER_LIST_INDEXES) {
      const { fields } = toFirestoreIndex(spec);
      expect(fields.at(-1)).toEqual({ fieldPath: "__name__", order: spec.direction });
      expect(fields.at(-2)).toEqual({ fieldPath: spec.orderField, order: spec.direction });
    }
  });

  it("serves every query the service can issue (all filters x sorts x directions, and both searches)", () => {
    const shapes: Array<Parameters<typeof buildListPlan>[0]> = [];
    for (const sort of ["createdAt", "fullName", "lastInteractionAt"] as const) {
      for (const dir of ["asc", "desc"] as const) {
        const b = { sort, dir };
        shapes.push(
          b,
          { ...b, tag: "x" },
          { ...b, assignedAgentId: "a" },
          ...CUSTOMER_SEGMENTS.map((segment) => ({ ...b, segment })),
          ...CUSTOMER_TYPES.map((customerType) => ({ ...b, customerType })),
        );
      }
    }
    shapes.push(
      { sort: "createdAt", dir: "desc", search: "jo" },
      { sort: "createdAt", dir: "desc", search: "0171" },
    );
    for (const q of shapes) {
      const plan = buildListPlan(q);
      const spec: CustomerIndexSpec | undefined = indexServing(plan.shape);
      expect(spec, JSON.stringify(plan.shape)).toBeDefined();
    }
  });

  it("indexServing needs the matching direction (no reverse-scan assumption)", () => {
    expect(indexServing({ orderField: "phoneE164", direction: "asc" })).toBeDefined();
    expect(indexServing({ orderField: "phoneE164", direction: "desc" })).toBeUndefined();
  });

  it("indexServing does not claim an index for a shape that is not in the table", () => {
    expect(
      indexServing({ filterField: "email", orderField: "createdAt", direction: "desc" }),
    ).toBeUndefined();
    expect(indexServing({ orderField: "email", direction: "asc" })).toBeUndefined();
  });
});
