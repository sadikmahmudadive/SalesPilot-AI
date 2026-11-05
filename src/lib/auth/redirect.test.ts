import { describe, expect, it } from "vitest";

import { PROTECTED_PREFIXES, decideRedirect, safeNextPath } from "./redirect";

const PREFIXES = [
  "/dashboard",
  "/inbox",
  "/agents",
  "/customers",
  "/products",
  "/inventory",
  "/orders",
  "/voice",
  "/automations",
  "/analytics",
  "/integrations",
  "/settings",
];

describe("PROTECTED_PREFIXES", () => {
  it("lists exactly the protected areas", () => {
    expect([...PROTECTED_PREFIXES].sort()).toEqual([...PREFIXES].sort());
  });
});

describe("decideRedirect: protected paths", () => {
  it.each(PREFIXES)("%s without cookie redirects to /login?next=", (prefix) => {
    expect(decideRedirect(prefix, "", false)).toBe(`/login?next=${encodeURIComponent(prefix)}`);
  });

  it.each(PREFIXES)("%s sub-path without cookie redirects, keeping path and search", (prefix) => {
    const path = `${prefix}/abc/def`;
    expect(decideRedirect(path, "?tab=1&x=a b", false)).toBe(
      `/login?next=${encodeURIComponent(`${path}?tab=1&x=a b`)}`,
    );
  });

  it.each(PREFIXES)("%s (and sub-path) with cookie passes through", (prefix) => {
    expect(decideRedirect(prefix, "", true)).toBeNull();
    expect(decideRedirect(`${prefix}/x`, "?a=1", true)).toBeNull();
  });

  it("handles a trailing slash", () => {
    expect(decideRedirect("/orders/", "", false)).toBe(`/login?next=${encodeURIComponent("/orders/")}`);
  });

  it("encodes characters that could break out of the query string", () => {
    const out = decideRedirect("/orders", "?a=1&next=//evil.com#frag", false)!;
    expect(out.startsWith("/login?next=")).toBe(true);
    expect(out.slice("/login?next=".length)).not.toMatch(/[&#?/]/);
    // The parameter round-trips to exactly the original path+search.
    const parsed = new URL(out, "http://localhost").searchParams.get("next");
    expect(parsed).toBe("/orders?a=1&next=//evil.com#frag");
  });

  it("always yields a same-origin relative location", () => {
    for (const p of PREFIXES) {
      const out = decideRedirect(p, "", false)!;
      expect(out.startsWith("/login?next=")).toBe(true);
    }
  });
});

describe("decideRedirect: lookalike and unrelated paths", () => {
  it.each(["/dashboardfoo", "/ordersx/1", "/settingsx", "/", "/pricing", "/about", "/loginx", "/x/dashboard"])(
    "%s is not protected",
    (p) => {
      expect(decideRedirect(p, "", false)).toBeNull();
      expect(decideRedirect(p, "", true)).toBeNull();
    },
  );

  it.each(["/api/x", "/api/auth/session", "/api/dashboard", "/_next/static/a.js", "/favicon.ico", "/robots.txt"])(
    "%s is never intercepted",
    (p) => {
      expect(decideRedirect(p, "", false)).toBeNull();
      expect(decideRedirect(p, "", true)).toBeNull();
    },
  );
});

describe("decideRedirect: auth pages", () => {
  it.each(["/login", "/register", "/login/", "/register/"])("%s with cookie redirects to /dashboard", (p) => {
    expect(decideRedirect(p, "", true)).toBe("/dashboard");
    expect(decideRedirect(p, "?next=//evil.com", true)).toBe("/dashboard");
  });

  it.each(["/login", "/register"])("%s without cookie renders", (p) => {
    expect(decideRedirect(p, "", false)).toBeNull();
    expect(decideRedirect(p, "?next=%2Forders", false)).toBeNull();
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/orders", "/orders"],
    ["/orders/12?tab=a&b=c", "/orders/12?tab=a&b=c"],
    ["/dashboard", "/dashboard"],
    ["/a#frag", "/a#frag"],
  ])("accepts %s", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["relative", "orders"],
    ["double slash", "//evil.com"],
    ["double slash path", "//evil.com/x"],
    ["slash backslash", "/\\evil.com"],
    ["backslash start", "\\evil.com"],
    ["double backslash", "\\\\evil.com"],
    ["absolute https", "https://evil.com"],
    ["absolute http", "http://evil.com/x"],
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,x"],
    ["protocol-relative with leading space", " //evil.com"],
    ["leading tab", "\t//evil.com"],
    ["slash tab slash", "/\t/evil.com"],
    ["slash newline slash", "/\n/evil.com"],
    ["slash CR", "/\r/evil.com"],
    ["NUL", "/a\u0000b"],
    ["DEL", "/a\u007fb"],
    ["C1 control", "/a\u0085b"],
    ["unicode line separator", "/a\u2028b"],
    ["backslash inside", "/a\\b"],
    ["just a space", " "],
    ["too long", "/" + "a".repeat(3000)],
  ])("rejects %s", (_label, raw) => {
    expect(safeNextPath(raw as string | null)).toBe("/dashboard");
  });
});
