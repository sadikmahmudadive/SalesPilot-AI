import { randomInt } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { adminAuth } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME, verifySessionValue } from "@/lib/auth/session";
import { createEmulatorUser, sleep, type EmulatorUser } from "@/test/auth-emulator";
import { withPinnedRateWindow } from "@/test/pin-clock";

import { DELETE, POST } from "./route";

const users: EmulatorUser[] = [];
afterAll(async () => {
  await Promise.all(
    users.map((u) =>
      adminAuth()
        .deleteUser(u.uid)
        .catch(() => undefined),
    ),
  );
});

/** Unique documentation-range IP per call so rate-limit counters never collide. */
const uniqueIp = (): string => `203.0.113.${randomInt(1, 255)}-${crypto.randomUUID()}`;

function post(
  body: unknown,
  ip: string = uniqueIp(),
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return POST(
    new Request("http://localhost/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, ...extraHeaders },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function cookieValue(setCookie: string): string {
  const m = new RegExp(`^${SESSION_COOKIE_NAME}=([^;]*)`).exec(setCookie);
  if (!m) throw new Error("no session cookie in Set-Cookie");
  return m[1]!;
}

async function signedInSession(): Promise<{ user: EmulatorUser; value: string }> {
  const user = await createEmulatorUser();
  users.push(user);
  const res = await post({ idToken: user.idToken });
  expect(res.status).toBe(200);
  return { user, value: cookieValue(res.headers.get("set-cookie")!) };
}

describe("POST /api/auth/session", () => {
  it("valid ID token -> 200, { ok: true } and an HttpOnly session cookie", async () => {
    const user = await createEmulatorUser();
    users.push(user);
    const res = await post({ idToken: user.idToken });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true });

    const setCookie = res.headers.get("set-cookie")!;
    const attrs = setCookie.split("; ");
    expect(attrs[0]).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=[A-Za-z0-9._~+/=-]+$`));
    // Exact attribute set (NODE_ENV=test, so no Secure).
    expect(attrs.slice(1)).toEqual([
      "Path=/",
      expect.stringMatching(/^Max-Age=\d+$/),
      "HttpOnly",
      "SameSite=Lax",
    ]);
    expect(res.headers.get("cache-control")).toBe("no-store");

    // The cookie we issued is a real, verifiable session for that user.
    await expect(verifySessionValue(cookieValue(setCookie))).resolves.toEqual({
      uid: user.uid,
      email: user.email,
    });
    // And the token is never echoed in the body.
    expect(text).not.toContain(user.idToken);
  });

  it("garbage token -> 401 UNAUTHENTICATED without a Set-Cookie", async () => {
    const res = await post({ idToken: "garbage" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.error.requestId).toBeTruthy();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("well-formed but unsigned/foreign-looking JWT -> 401, not 500", async () => {
    const fake = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from('{"sub":"x"}').toString("base64url")}.`;
    const res = await post({ idToken: fake });
    expect(res.status).toBe(401);
  });

  it("rejects the ID token of a user whose refresh tokens were revoked", async () => {
    const user = await createEmulatorUser();
    users.push(user);
    await sleep(1100);
    await adminAuth().revokeRefreshTokens(user.uid);
    const res = await post({ idToken: user.idToken });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it.each([
    ["missing body", ""],
    ["invalid JSON", "{nope"],
    ["empty object", "{}"],
    ["null body", "null"],
    ["array body", "[]"],
    ["idToken not a string", '{"idToken":123}'],
    ["idToken null", '{"idToken":null}'],
    ["idToken empty", '{"idToken":""}'],
    ["idToken enormous", JSON.stringify({ idToken: "a".repeat(20_000) })],
  ])("%s -> 400 VALIDATION_ERROR", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("does not leak the submitted token in validation errors", async () => {
    const res = await post({ idToken: 12345678 });
    expect(await res.text()).not.toContain("12345678");
  });

  it("11th request in a minute from the same IP -> 429 with Retry-After", async () => {
    await withPinnedRateWindow(async () => {
      const ip = uniqueIp();
      const statuses: number[] = [];
      for (let i = 0; i < 10; i++) statuses.push((await post({ idToken: "garbage" }, ip)).status);
      expect(statuses.every((s) => s === 401)).toBe(true);

      const res = await post({ idToken: "garbage" }, ip);
      expect(res.status).toBe(429);
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("RATE_LIMITED");
    });
  });

  it("limits per IP: another IP is unaffected", async () => {
    await withPinnedRateWindow(async () => {
      const ipA = uniqueIp();
      for (let i = 0; i < 11; i++) await post({ idToken: "garbage" }, ipA);
      const res = await post({ idToken: "garbage" }, uniqueIp());
      expect(res.status).toBe(401);
    });
  });

  it("keys the limit on the first x-forwarded-for entry", async () => {
    await withPinnedRateWindow(async () => {
      const client = uniqueIp();
      for (let i = 0; i < 10; i++) {
        await post({ idToken: "garbage" }, `${client}, 10.0.0.${i}`);
      }
      expect((await post({ idToken: "garbage" }, `${client}, 10.9.9.9`)).status).toBe(429);
    });
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    const realIp = uniqueIp();
    const withReal = (): Promise<Response> =>
      POST(
        new Request("http://localhost/api/auth/session", {
          method: "POST",
          headers: { "content-type": "application/json", "x-real-ip": realIp },
          body: JSON.stringify({ idToken: "garbage" }),
        }),
      );
    await withPinnedRateWindow(async () => {
      for (let i = 0; i < 10; i++) await withReal();
      expect((await withReal()).status).toBe(429);
    });
  });
});

describe("POST /api/auth/session: login CSRF guard", () => {
  const tokenBody = (idToken: string): string => JSON.stringify({ idToken });

  it("text/plain POST (cross-site form enctype=text/plain) -> 415 and no Set-Cookie, even with a valid token", async () => {
    const user = await createEmulatorUser();
    users.push(user);
    const res = await post(tokenBody(user.idToken), uniqueIp(), { "content-type": "text/plain" });
    expect(res.status).toBe(415);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "UNSUPPORTED_MEDIA_TYPE",
    );
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("form-urlencoded and multipart POSTs -> 415", async () => {
    for (const ct of ["application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const res = await post(tokenBody("garbage"), uniqueIp(), { "content-type": ct });
      expect(res.status).toBe(415);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("cross-origin Origin -> 403 and no Set-Cookie, even with a valid token", async () => {
    const user = await createEmulatorUser();
    users.push(user);
    const res = await post({ idToken: user.idToken }, uniqueIp(), { origin: "https://evil.com" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("Sec-Fetch-Site: cross-site -> 403 and no Set-Cookie", async () => {
    const user = await createEmulatorUser();
    users.push(user);
    const res = await post({ idToken: user.idToken }, uniqueIp(), {
      "sec-fetch-site": "cross-site",
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("Origin evil.com with a matching Host header still fails", async () => {
    const res = await post({ idToken: "garbage" }, uniqueIp(), {
      origin: "https://evil.com",
      host: "evil.com",
    });
    expect(res.status).toBe(403);
  });

  it("rejected requests do not consume the rate limit", async () => {
    const ip = uniqueIp();
    await withPinnedRateWindow(async () => {
      for (let i = 0; i < 12; i++)
        await post({ idToken: "garbage" }, ip, { origin: "https://evil.com" });
      expect((await post({ idToken: "garbage" }, ip)).status).toBe(401);
    });
  });

  it("same-origin JSON POST works (Origin + Sec-Fetch-Site: same-origin)", async () => {
    const user = await createEmulatorUser();
    users.push(user);
    const res = await post({ idToken: user.idToken }, uniqueIp(), {
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("JSON with a charset parameter works", async () => {
    const user = await createEmulatorUser();
    users.push(user);
    const res = await post({ idToken: user.idToken }, uniqueIp(), {
      "content-type": "application/json; charset=utf-8",
    });
    expect(res.status).toBe(200);
  });

  it("missing Origin plus JSON works (non-browser client)", async () => {
    const user = await createEmulatorUser();
    users.push(user);
    const res = await post({ idToken: user.idToken });
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/auth/session", () => {
  const del = (cookie?: string, extra: Record<string, string> = {}): Promise<Response> =>
    DELETE(
      new Request("http://localhost/api/auth/session", {
        method: "DELETE",
        headers: { ...(cookie ? { cookie: `${SESSION_COOKIE_NAME}=${cookie}` } : {}), ...extra },
      }),
    );

  it("cross-origin DELETE -> 403, no cookie change and the session is not revoked", async () => {
    const { value } = await signedInSession();
    await sleep(1100);
    const res = await del(value, { origin: "https://evil.com" });
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
    await expect(verifySessionValue(value)).resolves.not.toBeNull();
    const cross = await del(value, { "sec-fetch-site": "cross-site" });
    expect(cross.status).toBe(403);
    await expect(verifySessionValue(value)).resolves.not.toBeNull();
  });

  it("same-origin DELETE with any content type still works", async () => {
    const res = await del(undefined, {
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
    });
    expect(res.status).toBe(200);
  });

  function expectCleared(res: Response): void {
    expect(res.headers.get("set-cookie")!.split("; ")).toEqual([
      `${SESSION_COOKIE_NAME}=`,
      "Path=/",
      "Max-Age=0",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      "HttpOnly",
      "SameSite=Lax",
    ]);
  }

  it("clears the cookie and revokes the user's sessions", async () => {
    const { user, value } = await signedInSession();
    await expect(verifySessionValue(value)).resolves.not.toBeNull();
    await sleep(1100); // revocation timestamps have 1s granularity

    const res = await del(value);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expectCleared(res);

    // The old cookie is dead even if someone kept a copy.
    await expect(verifySessionValue(value)).resolves.toBeNull();
    const record = await adminAuth().getUser(user.uid);
    expect(new Date(record.tokensValidAfterTime!).getTime()).toBeGreaterThan(0);
  });

  it("returns 200 and clears the cookie when there is no cookie", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expectCleared(res);
  });

  it("returns 200 and clears the cookie for a garbage cookie", async () => {
    const res = await del("garbage");
    expect(res.status).toBe(200);
    expectCleared(res);
  });

  it("a garbage cookie does not revoke anyone else's sessions", async () => {
    const { value } = await signedInSession();
    await del("garbage");
    await expect(verifySessionValue(value)).resolves.not.toBeNull();
  });
});
