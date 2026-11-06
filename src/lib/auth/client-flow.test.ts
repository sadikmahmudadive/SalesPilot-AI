import { describe, expect, it, vi } from "vitest";

import {
  endSession,
  exchangeSession,
  fetchMe,
  mapAuthError,
  registerAccount,
  registerOrganizationRequest,
  resolvePostSignIn,
  signOutEverywhere,
  signOutNavigation,
} from "./client-flow";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function envelope(code: string, message = "server message", status = 400): Response {
  return json({ error: { code, message, requestId: "r1" } }, status);
}
const asFetch = (fn: unknown) => fn as typeof fetch;

describe("exchangeSession", () => {
  it("POSTs the token as JSON with same-origin credentials", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ ok: true }));
    const result = await exchangeSession("tok123", asFetch(fetchFn));
    expect(result).toEqual({ status: "ok" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("/api/auth/session");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ idToken: "tok123" });
  });

  it("maps 401 to unauthenticated and 429 to rate_limited", async () => {
    const r401 = await exchangeSession("t", asFetch(vi.fn().mockResolvedValue(envelope("UNAUTHENTICATED", "x", 401))));
    expect(r401.status).toBe("unauthenticated");
    const r429 = await exchangeSession("t", asFetch(vi.fn().mockResolvedValue(envelope("RATE_LIMITED", "x", 429))));
    expect(r429.status).toBe("rate_limited");
  });

  it("maps other failures to error without throwing, with a safe message", async () => {
    const result = await exchangeSession("t", asFetch(vi.fn().mockResolvedValue(envelope("INTERNAL", "secret stack", 500))));
    expect(result.status).toBe("error");
    expect(JSON.stringify(result)).not.toContain("secret stack");
  });

  it("maps a network failure and a non-JSON body to typed results, never throwing", async () => {
    const net = await exchangeSession("t", asFetch(vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))));
    expect(net.status).toBe("network");
    const html = new Response("<html>bad gateway</html>", { status: 502 });
    expect((await exchangeSession("t", asFetch(vi.fn().mockResolvedValue(html)))).status).toBe("error");
  });
});

describe("fetchMe", () => {
  it("returns the member on 200 using same-origin credentials", async () => {
    const me = { uid: "u1", email: "a@b.co", organizationId: "o1", role: "owner" };
    const fetchFn = vi.fn().mockResolvedValue(json(me));
    const result = await fetchMe(asFetch(fetchFn));
    expect(result).toEqual({ status: "ok", me });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("/api/me");
    expect(init.credentials).toBe("same-origin");
  });

  it("maps 401 -> unauthenticated, 403 -> no_organization, 429 -> rate_limited", async () => {
    const run = (r: Response) => fetchMe(asFetch(vi.fn().mockResolvedValue(r)));
    expect((await run(envelope("UNAUTHENTICATED", "x", 401))).status).toBe("unauthenticated");
    expect((await run(envelope("FORBIDDEN", "x", 403))).status).toBe("no_organization");
    expect((await run(envelope("RATE_LIMITED", "x", 429))).status).toBe("rate_limited");
  });

  it("treats a malformed 200 body as an error and a network failure as network", async () => {
    expect((await fetchMe(asFetch(vi.fn().mockResolvedValue(json({ nope: 1 }))))).status).toBe("error");
    expect((await fetchMe(asFetch(vi.fn().mockRejectedValue(new Error("offline"))))).status).toBe("network");
  });
});

describe("registerOrganizationRequest", () => {
  const body = { organizationName: "Acme", displayName: "Ada" };

  it("POSTs JSON same-origin and reports created on 201", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ organizationId: "o1", created: true }, 201));
    const result = await registerOrganizationRequest(body, asFetch(fetchFn));
    expect(result).toEqual({ status: "created", organizationId: "o1" });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("/api/organizations/register");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("reports exists on 200", async () => {
    const result = await registerOrganizationRequest(
      body,
      asFetch(vi.fn().mockResolvedValue(json({ organizationId: "o1", created: false }, 200))),
    );
    expect(result).toEqual({ status: "exists", organizationId: "o1" });
  });

  it("maps 401, 429, validation 400 and server errors without throwing", async () => {
    const run = (r: Response) => registerOrganizationRequest(body, asFetch(vi.fn().mockResolvedValue(r)));
    expect((await run(envelope("UNAUTHENTICATED", "x", 401))).status).toBe("unauthenticated");
    expect((await run(envelope("RATE_LIMITED", "x", 429))).status).toBe("rate_limited");
    expect((await run(envelope("VALIDATION_ERROR", "x", 400))).status).toBe("invalid");
    const server = await run(envelope("INTERNAL", "db exploded", 500));
    expect(server.status).toBe("error");
    expect(JSON.stringify(server)).not.toContain("db exploded");
    const net = await registerOrganizationRequest(body, asFetch(vi.fn().mockRejectedValue(new TypeError("x"))));
    expect(net.status).toBe("network");
  });
});

describe("resolvePostSignIn", () => {
  const me = { uid: "u1", email: "a@b.co", organizationId: "o1", role: "owner" };

  it("exchanges the session then routes members to the app", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(json({ ok: true })).mockResolvedValueOnce(json(me));
    expect(await resolvePostSignIn("tok", asFetch(fetchFn))).toEqual({ to: "app" });
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual(["/api/auth/session", "/api/me"]);
  });

  it("routes a user without an organization to onboarding", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(envelope("FORBIDDEN", "x", 403));
    expect(await resolvePostSignIn("tok", asFetch(fetchFn))).toEqual({ to: "onboarding" });
  });

  it("returns an error and stops when the session exchange fails", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(envelope("RATE_LIMITED", "x", 429));
    const result = await resolvePostSignIn("tok", asFetch(fetchFn));
    expect(result.to).toBe("error");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns an error when /api/me answers 401", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(envelope("UNAUTHENTICATED", "x", 401));
    expect((await resolvePostSignIn("tok", asFetch(fetchFn))).to).toBe("error");
  });
});

describe("endSession", () => {
  it("sends DELETE same-origin and never throws", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ ok: true }));
    await endSession(asFetch(fetchFn));
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("/api/auth/session");
    expect(init.method).toBe("DELETE");
    expect(init.credentials).toBe("same-origin");
    await expect(endSession(asFetch(vi.fn().mockRejectedValue(new Error("offline"))))).resolves.toBe(false);
  });

  it("reports whether the server cleared the session", async () => {
    expect(await endSession(asFetch(vi.fn().mockResolvedValue(json({ ok: true }))))).toBe(true);
    expect(await endSession(asFetch(vi.fn().mockResolvedValue(envelope("FORBIDDEN", "x", 403))))).toBe(false);
  });
});

describe("signOutEverywhere", () => {
  function setup(opts: { serverStatus?: number; serverThrows?: boolean; firebaseThrows?: boolean } = {}) {
    const calls: string[] = [];
    const fetchFn = vi.fn(async () => {
      calls.push("server");
      if (opts.serverThrows) throw new TypeError("offline");
      return json({ ok: true }, opts.serverStatus ?? 200);
    });
    const firebaseSignOut = vi.fn(async () => {
      calls.push("firebase");
      if (opts.firebaseThrows) throw new Error("firebase down");
    });
    return { calls, fetchFn, firebaseSignOut, deps: { fetch: asFetch(fetchFn), firebaseSignOut } };
  }

  it("clears the server session first, then signs out of Firebase", async () => {
    const { calls, fetchFn, deps } = setup();
    expect(await signOutEverywhere(deps)).toEqual({ ok: true });
    expect(calls).toEqual(["server", "firebase"]);
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/session");
    expect(init.method).toBe("DELETE");
    expect(init.credentials).toBe("same-origin");
  });

  it("still signs out of Firebase when the server call fails, and reports it", async () => {
    for (const opts of [{ serverThrows: true }, { serverStatus: 500 }]) {
      const { calls, deps } = setup(opts);
      const result = await signOutEverywhere(deps);
      expect(calls).toEqual(["server", "firebase"]);
      expect(result.ok).toBe(false);
    }
  });

  it("still reports completion of the server call when Firebase sign-out fails", async () => {
    const { calls, deps } = setup({ firebaseThrows: true });
    const result = await signOutEverywhere(deps);
    expect(calls).toEqual(["server", "firebase"]);
    expect(result.ok).toBe(false);
  });

  it("returns a fixed message and never echoes raw error text", async () => {
    const { deps } = setup({ serverThrows: true, firebaseThrows: true });
    const result = await signOutEverywhere(deps);
    expect(result).toEqual({ ok: false, serverCleared: false, message: expect.any(String) });
    expect(JSON.stringify(result)).not.toMatch(/offline|firebase down/);
  });

  it("reports serverCleared separately from the Firebase outcome", async () => {
    expect(await signOutEverywhere(setup({ firebaseThrows: true }).deps)).toMatchObject({ ok: false, serverCleared: true });
    expect(await signOutEverywhere(setup({ serverStatus: 500 }).deps)).toMatchObject({ ok: false, serverCleared: false });
  });
});

describe("signOutNavigation", () => {
  it("full success: client-side replace to /login, no toast", () => {
    expect(signOutNavigation({ ok: true })).toEqual({ kind: "replace", url: "/login" });
  });

  it("server cleared but Firebase failed: still replace to /login, with the toast", () => {
    const nav = signOutNavigation({ ok: false, serverCleared: true, message: "partial" });
    expect(nav).toEqual({ kind: "replace", url: "/login", toast: "partial" });
  });

  it("server DELETE failed: hard-navigate through /api/auth/expired (clears the cookie) with a device-only notice", () => {
    const nav = signOutNavigation({ ok: false, serverCleared: false, message: "x" });
    expect(nav.kind).toBe("assign");
    expect(nav.url).toBe("/api/auth/expired");
    expect(nav.toast).toMatch(/Signed out on this device/);
    expect(nav.toast).toMatch(/revocation/i);
  });
});

describe("mapAuthError", () => {
  const GENERIC_CREDS = "Incorrect email or password.";
  const GENERIC = "Something went wrong. Please try again.";

  // Exhaustive: every code the mapper knows about, with its exact outcome.
  const TABLE: Array<[string, string | null]> = [
    ["auth/wrong-password", GENERIC_CREDS],
    ["auth/user-not-found", GENERIC_CREDS],
    ["auth/invalid-credential", GENERIC_CREDS],
    ["auth/invalid-login-credentials", GENERIC_CREDS],
    ["auth/user-disabled", GENERIC_CREDS],
    ["auth/email-already-in-use", "An account with this email already exists. Try signing in instead."],
    [
      "auth/account-exists-with-different-credential",
      "This email is already linked to a different sign-in method. Use the method you originally signed up with.",
    ],
    ["auth/weak-password", "Choose a stronger password with at least 10 characters."],
    ["auth/too-many-requests", "Too many attempts. Please wait a few minutes and try again."],
    ["auth/network-request-failed", "Network problem. Check your connection and try again."],
    ["auth/popup-blocked", "Your browser blocked the sign-in popup. Allow popups and try again."],
    ["auth/popup-closed-by-user", null],
    ["auth/cancelled-popup-request", null],
  ];

  it.each(TABLE)("maps %s", (code, expected) => {
    expect(mapAuthError(code)).toBe(expected);
  });

  it("accepts codes without the auth/ prefix", () => {
    expect(mapAuthError("wrong-password")).toBe(GENERIC_CREDS);
    expect(mapAuthError("popup-closed-by-user")).toBeNull();
  });

  it("never reveals account existence through the credential errors", () => {
    const codes = ["wrong-password", "user-not-found", "invalid-credential", "invalid-login-credentials", "user-disabled"];
    expect(new Set(codes.map((c) => mapAuthError(`auth/${c}`))).size).toBe(1);
  });

  it("falls back to a generic message for unknown codes and never echoes raw text", () => {
    const message = mapAuthError("auth/some-new-code <b>x</b> secret@example.com");
    expect(message).toBe(GENERIC);
    expect(message).not.toContain("secret");
    expect(mapAuthError("")).toBe(GENERIC);
  });
});

describe("registerAccount", () => {
  const input = {
    displayName: "Ada",
    organizationName: "Acme",
    email: "ada@example.com",
    password: "correct-horse-battery",
    next: "/orders",
  };

  interface FakeUser {
    uid: string;
  }

  function makeDeps(
    overrides: { create?: () => Promise<void>; profile?: () => Promise<void>; token?: () => Promise<string> } = {},
  ) {
    const calls: string[] = [];
    const user: FakeUser = { uid: "u1" };
    const deps = {
      createUser: vi.fn(async () => {
        calls.push("createUser");
        await overrides.create?.();
        return user;
      }),
      updateProfile: vi.fn(async () => {
        calls.push("updateProfile");
        await overrides.profile?.();
      }),
      getIdToken: vi.fn(async () => {
        calls.push("getIdToken");
        return overrides.token ? overrides.token() : "id-token";
      }),
    };
    return { calls, user, deps };
  }

  function fetchSequence(...responses: Array<Response | Error>) {
    const fn = vi.fn();
    for (const r of responses) {
      if (r instanceof Error) fn.mockRejectedValueOnce(r);
      else fn.mockResolvedValueOnce(r);
    }
    return fn;
  }

  it("succeeds in the documented order and returns the safe next path", async () => {
    const { deps, calls, user } = makeDeps();
    const inner = fetchSequence(json({ ok: true }), json({ organizationId: "o1", created: true }, 201));
    const tracked = vi.fn(async (url: string, init: RequestInit) => {
      calls.push(url);
      return inner(url, init);
    });
    const result = await registerAccount({ ...deps, fetch: asFetch(tracked) }, input);
    expect(result).toEqual({ outcome: "success", path: "/orders" });
    expect(calls).toEqual(["createUser", "updateProfile", "getIdToken", "/api/auth/session", "/api/organizations/register"]);
    expect(deps.createUser).toHaveBeenCalledWith("ada@example.com", "correct-horse-battery");
    expect(deps.updateProfile).toHaveBeenCalledWith(user, "Ada");
    expect(deps.getIdToken).toHaveBeenCalledWith(user);
    expect(JSON.parse(inner.mock.calls[0]![1].body)).toEqual({ idToken: "id-token" });
    expect(JSON.parse(inner.mock.calls[1]![1].body)).toEqual({ organizationName: "Acme", displayName: "Ada" });
  });

  it.each(["//evil.com", "https://evil.com/x", "/\\evil.com", undefined])(
    "falls back to /dashboard for hostile or missing next (%s)",
    async (next) => {
      const { deps } = makeDeps();
      const fetchFn = fetchSequence(json({ ok: true }), json({ organizationId: "o1", created: true }, 201));
      const result = await registerAccount({ ...deps, fetch: asFetch(fetchFn) }, { ...input, next });
      expect(result).toEqual({ outcome: "success", path: "/dashboard" });
    },
  );

  it("treats an already-existing organization (200) as success", async () => {
    const { deps } = makeDeps();
    const fetchFn = fetchSequence(json({ ok: true }), json({ organizationId: "o1", created: false }, 200));
    expect((await registerAccount({ ...deps, fetch: asFetch(fetchFn) }, input)).outcome).toBe("success");
  });

  it("returns auth-failed with the mapped message when creating the user fails, and does nothing else", async () => {
    const { deps } = makeDeps({ create: () => Promise.reject({ code: "auth/email-already-in-use" }) });
    const fetchFn = vi.fn();
    const result = await registerAccount({ ...deps, fetch: asFetch(fetchFn) }, input);
    expect(result).toEqual({
      outcome: "auth-failed",
      message: "An account with this email already exists. Try signing in instead.",
    });
    expect(deps.updateProfile).not.toHaveBeenCalled();
    expect(deps.getIdToken).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("keeps going when updateProfile fails (cosmetic)", async () => {
    const { deps } = makeDeps({ profile: () => Promise.reject(new Error("profile down")) });
    const fetchFn = fetchSequence(json({ ok: true }), json({ organizationId: "o1", created: true }, 201));
    expect((await registerAccount({ ...deps, fetch: asFetch(fetchFn) }, input)).outcome).toBe("success");
  });

  it("returns session-failed (account exists, never re-register) when the session exchange fails", async () => {
    const { deps } = makeDeps();
    const fetchFn = fetchSequence(envelope("RATE_LIMITED", "x", 429));
    const result = await registerAccount({ ...deps, fetch: asFetch(fetchFn) }, input);
    expect(result.outcome).toBe("session-failed");
    expect(JSON.stringify(result)).toMatch(/account was created/i);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns session-failed when the ID token cannot be read after creation", async () => {
    const { deps } = makeDeps({ token: () => Promise.reject(new Error("token")) });
    const fetchFn = vi.fn();
    const result = await registerAccount({ ...deps, fetch: asFetch(fetchFn) }, input);
    expect(result.outcome).toBe("session-failed");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ["server error", () => envelope("INTERNAL", "boom", 500)],
    ["validation", () => envelope("VALIDATION_ERROR", "x", 400)],
    ["unauthenticated", () => envelope("UNAUTHENTICATED", "x", 401)],
    ["rate limit", () => envelope("RATE_LIMITED", "x", 429)],
  ])("returns onboarding when organization registration fails (%s)", async (_name, make) => {
    const { deps } = makeDeps();
    const fetchFn = fetchSequence(json({ ok: true }), make());
    const result = await registerAccount({ ...deps, fetch: asFetch(fetchFn) }, input);
    expect(result.outcome).toBe("onboarding");
    expect(JSON.stringify(result)).not.toContain("boom");
  });

  it("returns onboarding when organization registration hits a network failure", async () => {
    const { deps } = makeDeps();
    const fetchFn = fetchSequence(json({ ok: true }), new TypeError("Failed to fetch"));
    expect((await registerAccount({ ...deps, fetch: asFetch(fetchFn) }, input)).outcome).toBe("onboarding");
  });
});
