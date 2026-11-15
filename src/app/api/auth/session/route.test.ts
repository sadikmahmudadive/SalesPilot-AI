import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = { verifySessionCookie: vi.fn(), revokeRefreshTokens: vi.fn() };

vi.mock("@/lib/firebase/admin", () => ({ adminAuth: () => auth }));
vi.mock("@/config/env", () => ({
  getServerEnv: () => ({ NODE_ENV: "test", SESSION_COOKIE_MAX_DAYS: 5 }),
}));
vi.mock("@/lib/security/rate-limit", () => ({ assertRateLimit: vi.fn() }));

import { DELETE, POST } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
});

function post(body: BodyInit, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
  );
}

describe("session route: Cache-Control", () => {
  it("POST validation error envelope is no-store", async () => {
    const res = await post("not json");
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("POST CSRF rejection is no-store", async () => {
    const res = await post(JSON.stringify({ idToken: "x" }), { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("POST unexpected failure (500 envelope) is no-store", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { assertRateLimit } = await import("@/lib/security/rate-limit");
    vi.mocked(assertRateLimit).mockRejectedValue(new Error("firestore down"));
    const res = await post(JSON.stringify({ idToken: "x" }));
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("DELETE success is no-store", async () => {
    const res = await DELETE(
      new Request("http://localhost/api/auth/session", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("DELETE CSRF rejection is no-store", async () => {
    const res = await DELETE(
      new Request("http://localhost/api/auth/session", {
        method: "DELETE",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("DELETE /api/auth/session when Auth is unavailable", () => {
  it("still clears the cookie (and does not revoke) if verification throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    auth.verifySessionCookie.mockRejectedValue(new Error("network down"));
    const res = await DELETE(
      new Request("http://localhost/api/auth/session", {
        method: "DELETE",
        headers: { cookie: "__session=abc.def.ghi" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^__session=;.*Max-Age=0/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("abc.def.ghi");
    warn.mockRestore();
  });
});
