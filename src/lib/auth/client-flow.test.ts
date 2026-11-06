import { describe, expect, it, vi } from "vitest";

import {
  endSession,
  exchangeSession,
  fetchMe,
  isSilentAuthError,
  mapAuthError,
  registerOrganizationRequest,
  resolvePostSignIn,
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
    await expect(endSession(asFetch(vi.fn().mockRejectedValue(new Error("offline"))))).resolves.toBeUndefined();
  });
});

describe("mapAuthError", () => {
  const GENERIC_CREDS = "Incorrect email or password.";

  it.each(["auth/wrong-password", "auth/user-not-found", "auth/invalid-credential", "auth/invalid-login-credentials"])(
    "maps %s to the same generic credentials message",
    (code) => {
      expect(mapAuthError(code)).toBe(GENERIC_CREDS);
    },
  );

  it("accepts codes without the auth/ prefix", () => {
    expect(mapAuthError("wrong-password")).toBe(GENERIC_CREDS);
  });

  it("covers the other listed codes with friendly messages", () => {
    expect(mapAuthError("auth/email-already-in-use")).toMatch(/already/i);
    expect(mapAuthError("auth/weak-password")).toMatch(/password/i);
    expect(mapAuthError("auth/too-many-requests")).toMatch(/too many|try again/i);
    expect(mapAuthError("auth/network-request-failed")).toMatch(/network|connection/i);
  });

  it("shows nothing when the user closes the popup", () => {
    expect(mapAuthError("auth/popup-closed-by-user")).toBe("");
    expect(isSilentAuthError("auth/popup-closed-by-user")).toBe(true);
    expect(isSilentAuthError("auth/cancelled-popup-request")).toBe(true);
    expect(isSilentAuthError("auth/wrong-password")).toBe(false);
  });

  it("falls back to a generic message for unknown codes and never echoes raw text", () => {
    const raw = "auth/some-new-code <b>x</b> secret@example.com";
    const message = mapAuthError(raw);
    expect(message).toBe("Something went wrong. Please try again.");
    expect(message).not.toContain("secret");
    expect(mapAuthError("")).toBe("Something went wrong. Please try again.");
  });
});
