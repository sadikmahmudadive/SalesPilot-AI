import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetEnvCacheForTests } from "@/config/env";
import { withPinnedRateWindow } from "@/test/pin-clock";

import { GET, dynamic } from "./route";

// The sweep itself is covered by src/services/orders/sweep.int.test.ts; here it is a stub so the
// route's auth, rate limit and response shape are tested in isolation. The limiter is real.
const sweep = vi.hoisted(() => ({
  result: { expired: 2, released: 1, committed: 1, errors: 0 },
  calls: 0,
}));
vi.mock("@/services/orders/sweep", () => ({
  sweepOrders: vi.fn(async () => {
    sweep.calls++;
    return sweep.result;
  }),
}));

const SECRET = "cron-secret-0123456789abcdefghijklmnop";
const URL_ = "http://localhost/api/cron/orders/expire";

/** A request from a fresh client IP (each test gets its own rate-limit bucket). */
function call(headers: Record<string, string> = {}) {
  const h = new Headers({ "x-forwarded-for": `test-${randomUUID()}`, ...headers });
  return GET(new Request(URL_, { method: "GET", headers: h }));
}

function setSecret(value: string) {
  vi.stubEnv("CRON_SECRET", value);
  __resetEnvCacheForTests();
}

beforeEach(() => {
  sweep.calls = 0;
  setSecret(SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  __resetEnvCacheForTests();
  vi.restoreAllMocks();
});

describe("GET /api/cron/orders/expire", () => {
  it("is always dynamic", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("no Authorization header -> 401, the sweep does not run", async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");
    expect(sweep.calls).toBe(0);
  });

  it("wrong secret, wrong scheme or a prefix of the secret -> 401", async () => {
    for (const authorization of [
      "Bearer wrong",
      `Bearer ${SECRET}x`,
      `Bearer ${SECRET.slice(0, -1)}`,
      SECRET,
      `Basic ${SECRET}`,
      `bearer ${SECRET}`,
    ]) {
      const res = await call({ authorization });
      expect(res.status).toBe(401);
    }
    expect(sweep.calls).toBe(0);
  });

  it("unset CRON_SECRET -> 503 NOT_CONFIGURED, even with a header", async () => {
    setSecret("");
    const res = await call({ authorization: "Bearer " });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_CONFIGURED");
    expect(sweep.calls).toBe(0);
  });

  it("right secret -> 200 with the sweep counts, uncacheable", async () => {
    const res = await call({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(sweep.result);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(sweep.calls).toBe(1);
  });

  it("rate limits per IP before the secret check: the 31st call in a minute is 429", async () => {
    const ip = `test-${randomUUID()}`;
    const send = () =>
      GET(new Request(URL_, { method: "GET", headers: { "x-forwarded-for": ip } }));
    await withPinnedRateWindow(async () => {
      for (let i = 0; i < 30; i++) expect((await send()).status).toBe(401);
      const limited = await send();
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toEqual(expect.any(String));
    });
    expect(sweep.calls).toBe(0);
  });
});
