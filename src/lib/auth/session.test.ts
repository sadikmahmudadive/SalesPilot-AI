import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "@/lib/errors";

const auth = {
  verifyIdToken: vi.fn(),
  createSessionCookie: vi.fn(),
  verifySessionCookie: vi.fn(),
  revokeRefreshTokens: vi.fn(),
};
const envState = { NODE_ENV: "test" as string | undefined, SESSION_COOKIE_MAX_DAYS: 5 };

vi.mock("@/lib/firebase/admin", () => ({ adminAuth: () => auth }));
vi.mock("@/config/env", () => ({ getServerEnv: () => envState }));

import {
  MAX_AUTH_AGE_SEC,
  SESSION_COOKIE_NAME,
  assertRecentAuth,
  clearSessionCookie,
  createSessionCookie,
  readSessionCookie,
  serializeSessionCookie,
  verifySessionValue,
} from "./session";

const NOW = 1_800_000_000_000;

beforeEach(() => {
  vi.resetAllMocks();
  envState.NODE_ENV = "test";
  envState.SESSION_COOKIE_MAX_DAYS = 5;
});

describe("assertRecentAuth", () => {
  it("accepts a sign-in within 5 minutes", () => {
    expect(MAX_AUTH_AGE_SEC).toBe(300);
    expect(() => assertRecentAuth(NOW / 1000 - 299, NOW)).not.toThrow();
    expect(() => assertRecentAuth(NOW / 1000 - 300, NOW)).not.toThrow();
  });

  it("rejects a sign-in older than 5 minutes", () => {
    expect(() => assertRecentAuth(NOW / 1000 - 301, NOW)).toThrow(UnauthenticatedError);
  });

  it.each([undefined, null, "123", NaN, Infinity])(
    "rejects a missing or invalid auth_time (%s)",
    (v) => {
      expect(() => assertRecentAuth(v, NOW)).toThrow(UnauthenticatedError);
    },
  );

  it("rejects an auth_time in the future beyond clock skew", () => {
    expect(() => assertRecentAuth(NOW / 1000 + 3600, NOW)).toThrow(UnauthenticatedError);
  });
});

describe("createSessionCookie", () => {
  it("verifies the ID token (with revocation check) then creates the cookie", async () => {
    vi.useFakeTimers({ now: NOW });
    try {
      auth.verifyIdToken.mockResolvedValue({ uid: "u1", auth_time: NOW / 1000 - 10 });
      auth.createSessionCookie.mockResolvedValue("cookie-value");
      const out = await createSessionCookie("id-token");
      expect(auth.verifyIdToken).toHaveBeenCalledWith("id-token", true);
      expect(auth.createSessionCookie).toHaveBeenCalledWith("id-token", {
        expiresIn: 5 * 86_400_000,
      });
      expect(out).toEqual({ value: "cookie-value", maxAgeSec: 5 * 86_400 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses SESSION_COOKIE_MAX_DAYS from the server env", async () => {
    vi.useFakeTimers({ now: NOW });
    try {
      envState.SESSION_COOKIE_MAX_DAYS = 2;
      auth.verifyIdToken.mockResolvedValue({ uid: "u1", auth_time: NOW / 1000 });
      auth.createSessionCookie.mockResolvedValue("c");
      const out = await createSessionCookie("t");
      expect(out.maxAgeSec).toBe(2 * 86_400);
      expect(auth.createSessionCookie).toHaveBeenCalledWith("t", { expiresIn: 2 * 86_400_000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a stale ID token without minting a cookie", async () => {
    vi.useFakeTimers({ now: NOW });
    try {
      auth.verifyIdToken.mockResolvedValue({ uid: "u1", auth_time: NOW / 1000 - 3600 });
      await expect(createSessionCookie("t")).rejects.toBeInstanceOf(UnauthenticatedError);
      expect(auth.createSessionCookie).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps verifyIdToken failures to UnauthenticatedError (never a raw SDK error)", async () => {
    auth.verifyIdToken.mockRejectedValue(
      Object.assign(new Error("boom: secret"), { code: "auth/argument-error" }),
    );
    const err = await createSessionCookie("garbage").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthenticatedError);
    expect((err as Error).message).not.toContain("secret");
    expect(auth.createSessionCookie).not.toHaveBeenCalled();
  });

  it("maps createSessionCookie failures to UnauthenticatedError", async () => {
    vi.useFakeTimers({ now: NOW });
    try {
      auth.verifyIdToken.mockResolvedValue({ uid: "u1", auth_time: NOW / 1000 });
      auth.createSessionCookie.mockRejectedValue(new Error("nope"));
      await expect(createSessionCookie("t")).rejects.toBeInstanceOf(UnauthenticatedError);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([undefined, null, "", 42])("rejects a non-string or empty token (%s)", async (v) => {
    await expect(createSessionCookie(v as unknown as string)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(auth.verifyIdToken).not.toHaveBeenCalled();
  });
});

describe("verifySessionValue", () => {
  it("returns uid and email for a valid cookie, checking revocation", async () => {
    auth.verifySessionCookie.mockResolvedValue({ uid: "u1", email: "a@b.co" });
    await expect(verifySessionValue("v")).resolves.toEqual({ uid: "u1", email: "a@b.co" });
    expect(auth.verifySessionCookie).toHaveBeenCalledWith("v", true);
  });

  it("returns email null when the token has none", async () => {
    auth.verifySessionCookie.mockResolvedValue({ uid: "u1" });
    await expect(verifySessionValue("v")).resolves.toEqual({ uid: "u1", email: null });
  });

  it("returns null without calling the SDK for undefined/empty", async () => {
    await expect(verifySessionValue(undefined)).resolves.toBeNull();
    await expect(verifySessionValue("")).resolves.toBeNull();
    expect(auth.verifySessionCookie).not.toHaveBeenCalled();
  });

  it.each([
    "auth/session-cookie-expired",
    "auth/session-cookie-revoked",
    "auth/invalid-session-cookie",
    "auth/argument-error",
    "auth/user-disabled",
    "auth/user-not-found",
  ])("returns null for the Firebase Auth token/user error %s", async (code) => {
    auth.verifySessionCookie.mockRejectedValue(
      Object.assign(new Error("Firebase session cookie problem"), { code }),
    );
    await expect(verifySessionValue("v")).resolves.toBeNull();
  });

  it("returns null for an argument error that names the session cookie (decode / signature)", async () => {
    auth.verifySessionCookie.mockRejectedValue(
      Object.assign(new Error("Firebase session cookie has invalid signature."), {
        code: "auth/argument-error",
      }),
    );
    await expect(verifySessionValue("v")).resolves.toBeNull();
  });

  it.each([
    [
      "a plain network error",
      Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
    ],
    ["an SDK internal error", Object.assign(new Error("boom"), { code: "auth/internal-error" })],
    ["an app-level network error", Object.assign(new Error("x"), { code: "app/network-error" })],
    ["an error without a code", new Error("503 Service Unavailable")],
    [
      "a failure to fetch Google's public keys (reported as argument-error)",
      Object.assign(new Error("Error fetching public keys for Google certs: 503"), {
        code: "auth/argument-error",
      }),
    ],
  ])("rethrows %s and logs only its code", async (_label, error) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const COOKIE = "header.payload.SIGNATURE-secret-cookie-value";
    auth.verifySessionCookie.mockRejectedValue(error);
    await expect(verifySessionValue(COOKIE)).rejects.toBe(error);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toContain("session_verify_unavailable");
    expect(line).not.toContain(COOKIE);
    expect(line).not.toContain("SIGNATURE");
    expect(line).not.toContain((error as Error).message);
    warn.mockRestore();
  });

  it("rethrows if the SDK throws synchronously with a non-auth error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    auth.verifySessionCookie.mockImplementation(() => {
      throw new Error("sync");
    });
    await expect(verifySessionValue("v")).rejects.toThrow("sync");
    warn.mockRestore();
  });

  it("rethrows if adminAuth() itself is unavailable (server misconfiguration is not a sign-out)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("@/lib/firebase/admin", () => ({
      adminAuth: () => {
        throw new Error("no credentials");
      },
    }));
    vi.doMock("@/config/env", () => ({ getServerEnv: () => envState }));
    const fresh = await import("./session");
    await expect(fresh.verifySessionValue("v")).rejects.toThrow("no credentials");
    vi.doUnmock("@/lib/firebase/admin");
    warn.mockRestore();
  });

  it("returns null when the decoded token has no uid", async () => {
    auth.verifySessionCookie.mockResolvedValue({ email: "a@b.co" });
    await expect(verifySessionValue("v")).resolves.toBeNull();
  });
});

describe("cookie serialization", () => {
  it("names the cookie __session", () => {
    expect(SESSION_COOKIE_NAME).toBe("__session");
  });

  it("sets exactly Path=/, Max-Age, HttpOnly and SameSite=Lax (no Secure in test)", () => {
    const attrs = serializeSessionCookie("abc.def", 432000).split("; ");
    expect(attrs).toEqual([
      "__session=abc.def",
      "Path=/",
      "Max-Age=432000",
      "HttpOnly",
      "SameSite=Lax",
    ]);
  });

  it("adds exactly one Secure attribute in production", () => {
    envState.NODE_ENV = "production";
    const attrs = serializeSessionCookie("abc.def", 432000).split("; ");
    expect(attrs).toEqual([
      "__session=abc.def",
      "Path=/",
      "Max-Age=432000",
      "HttpOnly",
      "SameSite=Lax",
      "Secure",
    ]);
  });

  it("omits Secure in development and test", () => {
    for (const env of ["development", "test"]) {
      envState.NODE_ENV = env;
      expect(serializeSessionCookie("v", 10).split("; ")).not.toContain("Secure");
    }
  });

  it("includes Secure in production and when NODE_ENV is unset or unknown (fail safe)", () => {
    for (const env of ["production", undefined, "staging"]) {
      envState.NODE_ENV = env;
      expect(serializeSessionCookie("v", 10).split("; ")).toContain("Secure");
    }
  });

  it("refuses values that could inject cookie attributes or headers", () => {
    for (const bad of ["a;b", "a b", "a\r\nSet-Cookie: x=1", "a,b", 'a"b', ""]) {
      expect(() => serializeSessionCookie(bad, 10)).toThrow();
    }
  });

  it("rejects invalid max-age", () => {
    for (const bad of [-1, NaN, Infinity, 1.5]) {
      expect(() => serializeSessionCookie("v", bad)).toThrow();
    }
  });

  it("clearSessionCookie expires the cookie with the same attributes", () => {
    envState.NODE_ENV = "production";
    expect(clearSessionCookie().split("; ")).toEqual([
      "__session=",
      "Path=/",
      "Max-Age=0",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      "HttpOnly",
      "SameSite=Lax",
      "Secure",
    ]);
  });
});

describe("readSessionCookie", () => {
  it("extracts the session cookie from a Cookie header", () => {
    expect(readSessionCookie("__session=abc.def")).toBe("abc.def");
    expect(readSessionCookie("a=1; __session=abc.def; b=2")).toBe("abc.def");
  });

  it("returns undefined when absent, empty or the header is missing", () => {
    expect(readSessionCookie(null)).toBeUndefined();
    expect(readSessionCookie("")).toBeUndefined();
    expect(readSessionCookie("a=1; b=2")).toBeUndefined();
    expect(readSessionCookie("__session=")).toBeUndefined();
  });

  it("does not match cookies that merely end with the name", () => {
    expect(readSessionCookie("x__session=evil")).toBeUndefined();
    expect(readSessionCookie("x__session=evil; __session=good")).toBe("good");
  });
});
