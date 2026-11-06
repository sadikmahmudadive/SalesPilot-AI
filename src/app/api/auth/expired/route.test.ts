import { describe, expect, it, vi } from "vitest";

// Cookie attributes depend on NODE_ENV only; avoid requiring the full server env.
vi.mock("@/config/env", () => ({ getServerEnv: () => ({ NODE_ENV: "test", SESSION_COOKIE_MAX_DAYS: 5 }) }));
vi.mock("@/lib/firebase/admin", () => ({ adminAuth: () => ({}) }));

import { GET } from "./route";

function call(search: string): Response {
  return GET(new Request(`http://localhost:3000/api/auth/expired${search}`));
}

describe("GET /api/auth/expired", () => {
  it("clears the session cookie and 303s to /login with the encoded next", () => {
    const res = call("?next=/customers");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login?next=%2Fcustomers");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^__session=;/);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
  });

  it("keeps a safe path with a query string", () => {
    expect(call("?next=" + encodeURIComponent("/orders/42?tab=items")).headers.get("location")).toBe(
      "/login?next=%2Forders%2F42%3Ftab%3Ditems",
    );
  });

  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "", "/%2f%2fevil.com"])(
    "drops a hostile next (%s) rather than redirecting to it",
    (hostile) => {
      const res = call(`?next=${encodeURIComponent(hostile)}`);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/login");
      expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    },
  );

  it("goes to plain /login when next is missing, and the Location is always relative", () => {
    const res = call("");
    expect(res.headers.get("location")).toBe("/login");
    expect(res.headers.get("location")!.startsWith("/")).toBe(true);
  });

  it("is not cacheable", () => {
    expect(call("?next=/customers").headers.get("cache-control")).toBe("no-store");
  });
});
