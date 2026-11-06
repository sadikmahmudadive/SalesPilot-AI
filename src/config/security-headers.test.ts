import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";
import { securityHeaders } from "./security-headers";

function toMap(isDev: boolean): Map<string, string> {
  return new Map(securityHeaders(isDev).map((h) => [h.key, h.value]));
}

function directives(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const [name, ...values] = tokens;
    map.set(name!, values);
  }
  return map;
}

function cspOf(isDev: boolean): Map<string, string[]> {
  return directives(toMap(isDev).get("Content-Security-Policy")!);
}

describe("securityHeaders", () => {
  it("has unique header keys", () => {
    for (const dev of [true, false]) {
      const keys = securityHeaders(dev).map((h) => h.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("sets the static hardening headers", () => {
    for (const dev of [true, false]) {
      const h = toMap(dev);
      expect(h.get("X-Content-Type-Options")).toBe("nosniff");
      expect(h.get("X-Frame-Options")).toBe("DENY");
      expect(h.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(h.get("Cross-Origin-Opener-Policy")).toBe("same-origin-allow-popups");
      expect(h.get("X-DNS-Prefetch-Control")).toBe("off");
      const pp = h.get("Permissions-Policy")!;
      expect(pp).toContain("camera=()");
      expect(pp).toContain("microphone=()");
      expect(pp).toContain("geolocation=()");
      expect(pp).toContain("payment=()");
    }
  });

  it("sends HSTS in production only", () => {
    expect(toMap(false).get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(toMap(true).has("Strict-Transport-Security")).toBe(false);
  });

  it("allows unsafe-eval only in dev", () => {
    expect(cspOf(true).get("script-src")).toContain("'unsafe-eval'");
    expect(cspOf(false).get("script-src")).not.toContain("'unsafe-eval'");
    expect(toMap(false).get("Content-Security-Policy")).not.toContain("unsafe-eval");
  });

  it("only upgrades insecure requests in production", () => {
    expect(cspOf(false).has("upgrade-insecure-requests")).toBe(true);
    expect(cspOf(true).has("upgrade-insecure-requests")).toBe(false);
  });

  it("allows Cloudinary images and Google profile photos", () => {
    for (const dev of [true, false]) {
      const img = cspOf(dev).get("img-src")!;
      expect(img).toContain("https://res.cloudinary.com");
      expect(img).toContain("https://lh3.googleusercontent.com");
    }
  });

  it("allows the Google gapi script needed by Firebase popup/redirect sign-in", () => {
    for (const dev of [true, false]) {
      expect(cspOf(dev).get("script-src")).toContain("https://apis.google.com");
    }
  });

  it("allows Firebase Auth/Firestore and Cloudinary upload hosts in connect-src", () => {
    const connect = cspOf(false).get("connect-src")!;
    for (const host of [
      "https://identitytoolkit.googleapis.com",
      "https://securetoken.googleapis.com",
      "https://firestore.googleapis.com",
      "https://api.cloudinary.com",
    ]) {
      expect(connect).toContain(host);
    }
    expect(connect).not.toContain("http://127.0.0.1:*");
    expect(connect).not.toContain("http://localhost:*");
    expect(connect.filter((v) => v.startsWith("ws://") || v.startsWith("wss://"))).toEqual([]);
    expect(connect.filter((v) => v.startsWith("http://"))).toEqual([]);
  });

  it("allows emulator and HMR connections only in dev", () => {
    const dev = cspOf(true).get("connect-src")!;
    expect(dev).toContain("http://127.0.0.1:*");
    expect(dev).toContain("ws://localhost:*");
  });

  it("allows Firebase Auth frames", () => {
    const frame = cspOf(false).get("frame-src")!;
    expect(frame).toContain("https://*.firebaseapp.com");
    expect(frame).toContain("https://accounts.google.com");
  });

  it("is locked down for scripts and defaults", () => {
    for (const dev of [true, false]) {
      const csp = cspOf(dev);
      expect(csp.get("default-src")).toEqual(["'self'"]);
      const script = csp.get("script-src")!;
      expect(script.filter((v) => v.includes("*"))).toEqual([]);
      expect(csp.get("default-src")!.filter((v) => v.includes("*"))).toEqual([]);
      expect(script).not.toContain("data:");
      expect(script).not.toContain("blob:");
      expect(csp.get("object-src")).toEqual(["'none'"]);
      expect(csp.get("base-uri")).toEqual(["'self'"]);
      expect(csp.get("form-action")).toEqual(["'self'"]);
    }
  });

  it("has no duplicate CSP directives", () => {
    for (const dev of [true, false]) {
      const csp = toMap(dev).get("Content-Security-Policy")!;
      const names = csp
        .split(";")
        .map((p) => p.trim().split(/\s+/)[0])
        .filter(Boolean);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("agrees between frame-ancestors and X-Frame-Options", () => {
    for (const dev of [true, false]) {
      expect(cspOf(dev).get("frame-ancestors")).toEqual(["'none'"]);
      expect(toMap(dev).get("X-Frame-Options")).toBe("DENY");
    }
  });
});

describe("next.config headers()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function configured() {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    return rules[0]!;
  }

  it("disables the X-Powered-By header", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it.each([
    ["development", true],
    ["production", false],
    ["test", false],
    ["", false],
    ["staging", false],
  ])("applies securityHeaders for NODE_ENV=%j (isDev=%s)", async (env, isDev) => {
    vi.stubEnv("NODE_ENV", env);
    const rule = await configured();
    expect(rule.source).toBe("/(.*)");
    expect(rule.headers).toEqual(securityHeaders(isDev));
  });
});
