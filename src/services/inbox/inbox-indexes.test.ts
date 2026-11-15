import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { INBOX_LIST_INDEXES, toFirestoreIndex } from "./inbox-indexes";

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

describe("INBOX_LIST_INDEXES table", () => {
  it("has exactly the conversations indexes", () => {
    for (const spec of INBOX_LIST_INDEXES) {
      expect(spec.collectionGroup).toBe("conversations");
      expect(spec.note.length).toBeGreaterThan(10);
    }
  });

  it("starts with organizationId and ends with __name__ in the order field direction", () => {
    for (const spec of INBOX_LIST_INDEXES) {
      const { fields } = toFirestoreIndex(spec);
      expect(fields[0]).toEqual({ fieldPath: "organizationId", order: "ASCENDING" });
      expect(fields.at(-1)?.fieldPath).toBe("__name__");
      expect(fields.at(-1)?.order).toBe(fields.at(-2)?.order);
    }
  });

  it("equals the conversations entries of firestore.indexes.json exactly", () => {
    const table = INBOX_LIST_INDEXES.map((s) => canon(toFirestoreIndex(s))).sort();
    const json = of("conversations").map(canon).sort();
    expect(json).toEqual(table);
  });
});
