import { describe, expect, it } from "vitest";
import { z } from "zod";

import { assertValidRateLimitSpec, isNextControlFlowError, withApi, withAuthOnlyApi, zodIssuesToDetails } from "./handler";

describe("zodIssuesToDetails", () => {
  it("maps issues to field paths with static messages and never echoes input", () => {
    const secret = "TOP-SECRET-INPUT";
    const result = z
      .object({ a: z.string().min(2), nested: z.object({ n: z.number() }), only: z.literal("x") })
      .strict()
      .safeParse({ a: 1, nested: { n: secret }, only: secret, [secret]: secret });
    expect(result.success).toBe(false);
    if (result.success) return;
    const details = zodIssuesToDetails(result.error.issues);
    expect(details.map((d) => d.path)).toEqual(expect.arrayContaining(["a", "nested.n", "only"]));
    expect(JSON.stringify(details)).not.toContain(secret);
    for (const d of details) expect(typeof d.message).toBe("string");
  });

  it("uses 'body' for root-level issues", () => {
    const result = z.string().safeParse(5);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodIssuesToDetails(result.error.issues)).toEqual([{ path: "body", message: "Invalid type" }]);
  });
});

describe("rate limit spec validation (at construction time)", () => {
  const ok = { name: "thing", limit: 5, windowSec: 60 };
  const fn = async () => ({});

  it("accepts a valid spec", () => {
    expect(() => assertValidRateLimitSpec(ok)).not.toThrow();
    expect(() => withApi({ permission: "any-member", rateLimit: ok }, fn)).not.toThrow();
    expect(() => withAuthOnlyApi({ rateLimit: { ...ok, windowSec: 0.001 } }, fn)).not.toThrow();
  });

  it.each([
    ["limit 0", { limit: 0 }],
    ["limit negative", { limit: -1 }],
    ["limit fractional", { limit: 1.5 }],
    ["limit NaN", { limit: Number.NaN }],
    ["windowSec 0", { windowSec: 0 }],
    ["windowSec negative", { windowSec: -5 }],
    ["windowSec Infinity", { windowSec: Number.POSITIVE_INFINITY }],
    ["windowSec NaN", { windowSec: Number.NaN }],
    ["windowSec under 1ms", { windowSec: 0.0001 }],
    ["empty name", { name: "" }],
    ["name with colon", { name: "a:b" }],
  ])("throws when defining a route with %s", (_label, patch) => {
    const spec = { ...ok, ...patch };
    expect(() => withApi({ permission: "any-member", rateLimit: spec }, fn)).toThrow(/withApi: rateLimit/);
    expect(() => withAuthOnlyApi({ rateLimit: spec }, fn)).toThrow(/withApi: rateLimit/);
  });
});

describe("isNextControlFlowError", () => {
  it.each([
    [Object.assign(new Error("x"), { digest: "NEXT_REDIRECT;push;/a;307;" }), true],
    [Object.assign(new Error("x"), { digest: "NEXT_HTTP_ERROR_FALLBACK;403" }), true],
    [Object.assign(new Error("x"), { digest: "DYNAMIC_SERVER_USAGE" }), true],
    [{ digest: "NEXT_ANYTHING" }, true],
    [Object.assign(new Error("x"), { digest: "next_redirect" }), false],
    [Object.assign(new Error("x"), { digest: "OTHER" }), false],
    [Object.assign(new Error("x"), { digest: 5 }), false],
    [new Error("plain"), false],
    [null, false],
    ["NEXT_REDIRECT", false],
    [undefined, false],
    [Object.assign(Response.json({}), { digest: "NEXT_REDIRECT" }), false],
  ])("%#", (err, expected) => {
    expect(isNextControlFlowError(err)).toBe(expected);
  });

  it("does not throw on a hostile digest getter", () => {
    const hostile = {
      get digest(): string {
        throw new Error("boom");
      },
    };
    expect(isNextControlFlowError(hostile)).toBe(false);
  });
});
