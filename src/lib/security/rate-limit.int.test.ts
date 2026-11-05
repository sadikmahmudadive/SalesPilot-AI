import { createHash, randomUUID } from "node:crypto";

import { FieldPath } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import { RateLimitedError, ValidationError } from "@/lib/errors";
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

describe("checkRateLimit input validation", () => {
  const cases: Array<[string, string, Partial<{ limit: number; windowSec: number }>]> = [
    ["limit 0", "limit", { limit: 0 }],
    ["limit -1", "limit", { limit: -1 }],
    ["limit 1.5", "limit", { limit: 1.5 }],
    ["limit NaN", "limit", { limit: NaN }],
    ["windowSec 0", "windowSec", { windowSec: 0 }],
    ["windowSec -1", "windowSec", { windowSec: -1 }],
    ["windowSec NaN", "windowSec", { windowSec: NaN }],
    ["windowSec Infinity", "windowSec", { windowSec: Infinity }],
    ["windowSec sub-millisecond", "windowSec", { windowSec: 0.0001 }],
  ];

  it.each(cases)("rejects %s without writing", async (_label, field, override) => {
    const key = newKey("invalid");
    const err = await checkRateLimit(key, { ...opts, ...override }, Date.now()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(JSON.stringify((err as ValidationError).details)).toContain(`opts.${field}`);
    expect((await docsFor(key)).empty).toBe(true);
  });

  it.each([NaN, Infinity])("rejects non-finite now (%s) without writing", async (now) => {
    const key = newKey("invalid-now");
    await expect(checkRateLimit(key, opts, now)).rejects.toBeInstanceOf(ValidationError);
    expect((await docsFor(key)).empty).toBe(true);
  });

  it("rejects an empty key without writing and does not echo values", async () => {
    const before = (await adminDb().collection("rateLimits").get()).size;
    const err = await checkRateLimit("", opts, Date.now()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(JSON.stringify((err as ValidationError).details)).toContain("key");
    expect((await adminDb().collection("rateLimits").get()).size).toBe(before);
  });

  it("does not include the offending values in the error details", async () => {
    const secretKey = "";
    const err = (await checkRateLimit(secretKey, { limit: 1.5, windowSec: -7 }, 12345.5).catch(
      (e: unknown) => e,
    )) as ValidationError;
    const text = JSON.stringify(err.details);
    expect(text).not.toContain("1.5");
    expect(text).not.toContain("-7");
  });

  it("assertRateLimit also rejects invalid input with ValidationError", async () => {
    await expect(assertRateLimit("", opts)).rejects.toBeInstanceOf(ValidationError);
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
