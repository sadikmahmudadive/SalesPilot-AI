import { createHash, randomUUID } from "node:crypto";

import { FieldPath } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import { RateLimitedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";

import { assertRateLimit, checkRateLimit } from "./rate-limit";

const opts = { limit: 3, windowSec: 60 };
const keys: string[] = [];
const newKey = (label: string): string => {
  const key = `${label}-${randomUUID()}`;
  keys.push(key);
  return key;
};
const hashOf = (key: string): string => createHash("sha256").update(key).digest("hex").slice(0, 32);
const docsFor = (key: string) =>
  adminDb()
    .collection("rateLimits")
    .where(FieldPath.documentId(), ">=", `${hashOf(key)}_`)
    .where(FieldPath.documentId(), "<", `${hashOf(key)}_`)
    .get();

afterAll(async () => {
  for (const key of keys) {
    const snap = await docsFor(key);
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
});

describe("checkRateLimit", () => {
  it("allows up to the limit then blocks", async () => {
    const key = newKey("seq");
    const now = Date.UTC(2030, 0, 1, 0, 0, 10);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await checkRateLimit(key, opts, now));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[0]!.resetAt).toBe(Date.UTC(2030, 0, 1, 0, 1, 0));
  });

  it("is exact under 20 concurrent calls with limit 5", async () => {
    const key = newKey("conc");
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => checkRateLimit(key, { limit: 5, windowSec: 60 }, now)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.filter((r) => !r.allowed)).toHaveLength(15);
  });

  it("keeps different keys independent", async () => {
    const a = newKey("a");
    const b = newKey("b");
    const now = Date.now();
    for (let i = 0; i < 3; i++) await checkRateLimit(a, opts, now);
    expect((await checkRateLimit(a, opts, now)).allowed).toBe(false);
    expect((await checkRateLimit(b, opts, now)).allowed).toBe(true);
  });

  it("resets in a new window", async () => {
    const key = newKey("win");
    const now = Date.UTC(2030, 0, 1, 0, 0, 10);
    for (let i = 0; i < 3; i++) await checkRateLimit(key, opts, now);
    expect((await checkRateLimit(key, opts, now)).allowed).toBe(false);
    const next = await checkRateLimit(key, opts, now + 60_000);
    expect(next.allowed).toBe(true);
    expect(next.remaining).toBe(2);
  });

  it("never stores the raw key", async () => {
    const key = newKey("10.1.2.3");
    await checkRateLimit(key, opts, Date.now());
    const snap = await docsFor(key);
    expect(snap.size).toBe(1);
    const doc = snap.docs[0]!;
    expect(doc.id.startsWith(`${hashOf(key)}_`)).toBe(true);
    expect(JSON.stringify(doc.data())).not.toContain(key);
    expect(doc.get("expiresAt")).toBeDefined();
  });
});

describe("assertRateLimit", () => {
  it("throws RateLimitedError with retryAfterSec once over the limit", async () => {
    const key = newKey("assert");
    const now = Date.UTC(2030, 0, 1, 0, 0, 10);
    for (let i = 0; i < 3; i++) await assertRateLimit(key, opts, now);
    const err = await assertRateLimit(key, opts, now).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfterSec).toBe(50);
  });
});
