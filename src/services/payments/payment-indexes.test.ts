import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { normalizedIndexKey } from "@/lib/firestore-index-table";

import { PAYMENT_INDEXES, toFirestoreIndex } from "./payment-indexes";

interface IndexJson {
  collectionGroup: string;
  queryScope: string;
  fields: Array<{ fieldPath: string; order: "ASCENDING" | "DESCENDING" }>;
}

const file = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../firestore.indexes.json"), "utf8"),
) as { indexes: IndexJson[] };
const ofGroup = (...groups: string[]) =>
  file.indexes.filter((i) => groups.includes(i.collectionGroup));
const canon = (i: unknown) => JSON.stringify(i);

describe("PAYMENT_INDEXES table", () => {
  it("has no duplicate entries", () => {
    const keys = PAYMENT_INDEXES.map((s) => canon(toFirestoreIndex(s)));
    expect(new Set(keys).size).toBe(keys.length);
    const normalized = PAYMENT_INDEXES.map((s) => normalizedIndexKey(toFirestoreIndex(s)));
    expect(new Set(normalized).size).toBe(normalized.length);
  });

  it("every entry is present in firestore.indexes.json in the exact Firebase format", () => {
    const present = new Set(ofGroup("paymentAttempts", "gatewayAccounts").map(canon));
    for (const spec of PAYMENT_INDEXES) {
      expect(present.has(canon(toFirestoreIndex(spec))), JSON.stringify(spec)).toBe(true);
    }
  });

  it("firestore.indexes.json has no unlisted paymentAttempts / gatewayAccounts indexes", () => {
    const listed = new Set(PAYMENT_INDEXES.map((s) => canon(toFirestoreIndex(s))));
    const json = ofGroup("paymentAttempts", "gatewayAccounts");
    for (const index of json) expect(listed.has(canon(index)), canon(index)).toBe(true);
  });
});
