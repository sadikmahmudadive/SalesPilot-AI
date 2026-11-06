import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { PROTECTED_PREFIXES } from "@/lib/auth/redirect";

import { config, proxy } from "./proxy";

function run(path: string, cookie?: string) {
  const req = new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie: `__session=${cookie}` } : {},
  });
  return proxy(req);
}

describe("proxy matcher", () => {
  it("covers every protected prefix and the auth pages, and nothing else", () => {
    const expected = [...PROTECTED_PREFIXES.map((p) => `${p}/:path*`), "/login", "/register"];
    expect([...config.matcher].sort()).toEqual(expected.sort());
  });

  it("does not match /api or _next", () => {
    for (const m of config.matcher) {
      expect(m.startsWith("/api")).toBe(false);
      expect(m.startsWith("/_next")).toBe(false);
    }
  });
});

describe("proxy", () => {
  it("redirects an anonymous visitor to /login with the original path and query", () => {
    const res = run("/orders/42?tab=items");
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin).toBe("http://localhost:3000");
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/orders/42?tab=items");
  });

  it("lets a visitor with a cookie through", () => {
    const res = run("/dashboard", "abc");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("forwards the requested path to server components via x-sp-path, overwriting any client-sent value", () => {
    const req = new NextRequest("http://localhost:3000/orders/42?tab=items", {
      headers: { cookie: "__session=abc", "x-sp-path": "//evil.com" },
    });
    const res = proxy(req);
    expect(res.headers.get("x-middleware-request-x-sp-path")).toBe("/orders/42?tab=items");
    expect(res.headers.get("x-middleware-override-headers")).toContain("x-sp-path");
  });

  it("sends a signed-in visitor away from /login and /register", () => {
    for (const p of ["/login", "/register"]) {
      const res = run(p, "abc");
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
    }
  });

  it("treats an empty cookie as absent", () => {
    expect(run("/inbox", "").status).toBe(307);
  });

  it("lets anonymous visitors see /login", () => {
    expect(run("/login").headers.get("location")).toBeNull();
  });
});
