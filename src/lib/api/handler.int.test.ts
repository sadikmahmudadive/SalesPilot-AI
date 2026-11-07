import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import type { Role } from "@/lib/security/permissions";
import { withPinnedRateWindow } from "@/test/pin-clock";

import { withApi, withAuthOnlyApi } from "./handler";

// Fake session: the real cookie verification is covered by session tests.
let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

const URL_ = "http://localhost/api/test";
const created = { users: [] as string[], members: [] as string[] };

async function seedMember(role: Role, organizationId = `org-${randomUUID()}`) {
  const uid = `uid-${randomUUID()}`;
  const db = adminDb();
  await db.collection("users").doc(uid).set({ uid, email: `${uid}@x.com`, defaultOrganizationId: organizationId });
  await db.collection("organizationMembers").doc(`${organizationId}_${uid}`).set({ organizationId, uid, role });
  created.users.push(uid);
  created.members.push(`${organizationId}_${uid}`);
  return { uid, organizationId };
}

function signIn(uid: string, email: string | null = `${uid}@x.com`) {
  session = { uid, email };
}

function post(body?: unknown, headers: Record<string, string> = { "content-type": "application/json" }): Request {
  const raw = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  const h = new Headers(headers);
  if (raw !== undefined) h.set("content-length", String(Buffer.byteLength(raw)));
  return new Request(URL_, { method: "POST", headers: h, body: raw });
}
const get = (headers: Record<string, string> = {}) => new Request(URL_, { method: "GET", headers });

async function errorOf(res: Response) {
  return ((await res.json()) as { error: { code: string; message: string; requestId: string; details?: unknown } }).error;
}

beforeEach(() => {
  session = null;
});

afterAll(async () => {
  const db = adminDb();
  await Promise.all([
    ...created.users.map((u) => db.collection("users").doc(u).delete()),
    ...created.members.map((m) => db.collection("organizationMembers").doc(m).delete()),
  ]);
});

describe("withApi: auth and membership", () => {
  it("401 without a session, and the handler never runs", async () => {
    const fn = vi.fn(async () => ({ ok: true }));
    const res = await withApi({ permission: "any-member" }, fn)(get());
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("UNAUTHENTICATED");
    expect(fn).not.toHaveBeenCalled();
  });

  it("403 for an authenticated user with no membership (no users doc)", async () => {
    signIn(`uid-${randomUUID()}`);
    const fn = vi.fn(async () => ({ ok: true }));
    const res = await withApi({ permission: "any-member" }, fn)(get());
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("FORBIDDEN");
    expect(fn).not.toHaveBeenCalled();
  });

  it("403 when the member doc has an unknown role (fail closed)", async () => {
    const { uid, organizationId } = await seedMember("owner");
    await adminDb().collection("organizationMembers").doc(`${organizationId}_${uid}`).update({ role: "root" });
    signIn(uid);
    const fn = vi.fn(async () => ({}));
    expect((await withApi({ permission: "any-member" }, fn)(get())).status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
  });

  it("passes uid, email, organizationId and role from the verified session and membership", async () => {
    const { uid, organizationId } = await seedMember("agent");
    signIn(uid, "me@x.com");
    const res = await withApi({ permission: "any-member" }, async (ctx) => ({
      uid: ctx.uid,
      email: ctx.email,
      organizationId: ctx.organizationId,
      role: ctx.role,
      body: ctx.body ?? null,
    }))(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uid, email: "me@x.com", organizationId, role: "agent", body: null });
  });
});

describe("withApi: permission", () => {
  it("403 for a viewer on customers:write, handler not called", async () => {
    const { uid } = await seedMember("viewer");
    signIn(uid);
    const fn = vi.fn(async () => ({ ok: true }));
    const res = await withApi({ permission: "customers:write" }, fn)(post({}));
    expect(res.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
  });

  it("allows an agent on customers:write and a viewer on customers:read", async () => {
    const agent = await seedMember("agent");
    signIn(agent.uid);
    expect((await withApi({ permission: "customers:write" }, async () => ({ ok: 1 }))(post({}))).status).toBe(200);
    const viewer = await seedMember("viewer");
    signIn(viewer.uid);
    expect((await withApi({ permission: "customers:read" }, async () => ({ ok: 1 }))(get())).status).toBe(200);
  });

  it("permission is checked before the rate limit and body parse", async () => {
    const { uid } = await seedMember("viewer");
    signIn(uid);
    const schema = z.object({ a: z.string() });
    const res = await withApi(
      { permission: "customers:write", schema, rateLimit: { name: `perm-${randomUUID()}`, limit: 1, windowSec: 60 } },
      async () => ({}),
    )(post({ a: 1 }));
    expect(res.status).toBe(403);
  });
});

describe("withApi: body", () => {
  const schema = z.object({ name: z.string().min(2), age: z.number().int() });

  it("parses a valid body into ctx.body", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const res = await withApi({ permission: "any-member", schema }, async ({ body }) => ({ got: body }))(post({ name: "Jo", age: 3 }));
    expect(await res.json()).toEqual({ got: { name: "Jo", age: 3 } });
  });

  it("400 on a schema failure with field paths and no input values", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const secret = "SECRET-VALUE-123";
    const fn = vi.fn(async () => ({}));
    const res = await withApi({ permission: "any-member", schema }, fn)(post({ name: "x", age: secret }));
    expect(res.status).toBe(400);
    const err = await errorOf(res);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "name" }), expect.objectContaining({ path: "age" })]),
    );
    expect(JSON.stringify(err)).not.toContain(secret);
    expect(fn).not.toHaveBeenCalled();
  });

  it("400 on invalid JSON", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const res = await withApi({ permission: "any-member", schema }, async () => ({}))(post("{not json"));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("VALIDATION_ERROR");
  });

  it("400 when the body is missing but a schema is set", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const res = await withApi({ permission: "any-member", schema }, async () => ({}))(post(undefined));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("VALIDATION_ERROR");
  });

  it("415 for text/plain when a schema is set", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const res = await withApi({ permission: "any-member", schema }, async () => ({}))(post('{"name":"Jo","age":1}', { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
  });

  it("organizationId in the body is ignored: ctx.organizationId comes from membership", async () => {
    const { uid, organizationId } = await seedMember("owner");
    signIn(uid);
    const bodySchema = z.object({ name: z.string() });
    const res = await withApi({ permission: "any-member", schema: bodySchema }, async (ctx) => ({
      organizationId: ctx.organizationId,
      body: ctx.body,
    }))(post({ name: "Jo", organizationId: "other-org", orgId: "other-org" }));
    expect(await res.json()).toEqual({ organizationId, body: { name: "Jo" } });
  });

  it("organizationId in query string and headers is ignored", async () => {
    const { uid, organizationId } = await seedMember("owner");
    signIn(uid);
    const req = new Request(`${URL_}?organizationId=other-org`, {
      headers: { "x-organization-id": "other-org", "x-forwarded-organization-id": "other-org" },
    });
    const res = await withApi({ permission: "any-member" }, async (ctx) => ({ organizationId: ctx.organizationId }))(req);
    expect(await res.json()).toEqual({ organizationId });
  });

  it("a schema-less mutating request with no body is fine and body is undefined", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const res = await withApi({ permission: "any-member" }, async ({ body }) => ({ body: body === undefined }))(post(undefined, {}));
    expect(await res.json()).toEqual({ body: true });
  });
});

describe("withApi: csrf", () => {
  it("403 for a cross-origin POST before auth is even evaluated", async () => {
    const fn = vi.fn(async () => ({}));
    const res = await withApi({ permission: "any-member" }, fn)(post({}, { "content-type": "application/json", origin: "https://evil.com" }));
    expect(res.status).toBe(403); // no session set: would be 401 if csrf ran later
    expect(fn).not.toHaveBeenCalled();
  });

  it("403 for Sec-Fetch-Site cross-site", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const res = await withApi({ permission: "any-member" }, async () => ({}))(post({}, { "content-type": "application/json", "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
  });

  it("accepts a same-origin POST", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const res = await withApi({ permission: "any-member" }, async () => ({ ok: 1 }))(
      post({}, { "content-type": "application/json", origin: "http://localhost", "sec-fetch-site": "same-origin" }),
    );
    expect(res.status).toBe(200);
  });

  it("csrf: false skips the origin check", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const res = await withApi({ permission: "any-member", csrf: false }, async () => ({ ok: 1 }))(
      post({}, { "content-type": "application/json", origin: "https://evil.com" }),
    );
    expect(res.status).toBe(200);
  });

  it("GET is not subject to csrf", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const res = await withApi({ permission: "any-member" }, async () => ({ ok: 1 }))(get({ origin: "https://evil.com", "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(200);
  });

  it("requireJson is only enforced when a schema is set", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const plain = { "content-type": "text/plain" };
    expect((await withApi({ permission: "any-member" }, async () => ({ ok: 1 }))(post("hello", plain))).status).toBe(200);
    expect((await withApi({ permission: "any-member", schema: z.object({}) }, async () => ({ ok: 1 }))(post("hello", plain))).status).toBe(415);
  });
});

describe("withApi: rate limit", () => {
  it("429 with Retry-After once the per-user limit is exceeded; other users unaffected", async () => {
    const name = `rl-${randomUUID()}`;
    const a = await seedMember("owner");
    const b = await seedMember("owner");
    const h = withApi({ permission: "any-member", rateLimit: { name, limit: 2, windowSec: 60 } }, async () => ({ ok: 1 }));
    await withPinnedRateWindow(async () => {
      signIn(a.uid);
      expect((await h(get())).status).toBe(200);
      expect((await h(get())).status).toBe(200);
      const res = await h(get());
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBeTruthy();
      expect((await errorOf(res)).code).toBe("RATE_LIMITED");
      signIn(b.uid);
      expect((await h(get())).status).toBe(200);
    });
  });

  it("different limiter names do not share counters", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const one = withApi({ permission: "any-member", rateLimit: { name: `n1-${randomUUID()}`, limit: 1, windowSec: 60 } }, async () => ({}));
    const two = withApi({ permission: "any-member", rateLimit: { name: `n2-${randomUUID()}`, limit: 1, windowSec: 60 } }, async () => ({}));
    await withPinnedRateWindow(async () => {
      expect((await one(get())).status).toBe(200);
      expect((await two(get())).status).toBe(200);
      expect((await one(get())).status).toBe(429);
    });
  });
});

describe("withApi: responses", () => {
  it("unexpected throw -> 500 envelope without leaking the message", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const spy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const res = await withApi({ permission: "any-member" }, async () => {
      throw new Error("db password is hunter2");
    })(get());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("hunter2");
    const err = JSON.parse(text).error;
    expect(err).toMatchObject({ code: "INTERNAL_ERROR", message: "Internal server error" });
    expect(res.headers.get("x-request-id")).toBe(err.requestId);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("every response carries x-request-id and Cache-Control: no-store (success and error)", async () => {
    const { uid } = await seedMember("viewer");
    signIn(uid);
    const ok = await withApi({ permission: "any-member" }, async () => ({ ok: 1 }))(get());
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const denied = await withApi({ permission: "customers:write" }, async () => ({}))(get());
    expect(denied.headers.get("cache-control")).toBe("no-store");
    const id = denied.headers.get("x-request-id");
    expect(id).toBeTruthy();
    expect((await errorOf(denied)).requestId).toBe(id);
    session = null;
    const unauth = await withApi({ permission: "any-member" }, async () => ({}))(get());
    expect(unauth.headers.get("x-request-id")).toBeTruthy();
    expect(unauth.headers.get("cache-control")).toBe("no-store");
  });

  it("a returned Response is used as-is (status, body) but gets the standard headers", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const res = await withApi({ permission: "any-member" }, async () => Response.json({ made: true }, { status: 201, headers: { "x-custom": "1" } }))(get());
    expect(res.status).toBe(201);
    expect(res.headers.get("x-custom")).toBe("1");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(await res.json()).toEqual({ made: true });
  });

  it("an immutable returned Response (Response.redirect) still works", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const res = await withApi({ permission: "any-member" }, async () => Response.redirect("http://localhost/next", 302))(get());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/next");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("a plain object -> 200 JSON", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const res = await withApi({ permission: "any-member" }, async () => ({ hello: "world" }))(get());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ hello: "world" });
  });

  it("awaits route params", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const res = await withApi({ permission: "any-member" }, async ({ params }) => ({ params }))(get(), { params: Promise.resolve({ id: "42" }) });
    expect(await res.json()).toEqual({ params: { id: "42" } });
  });
});

describe("withAuthOnlyApi", () => {
  it("runs without any membership and exposes no organizationId/role", async () => {
    const uid = `uid-${randomUUID()}`;
    signIn(uid, "new@x.com");
    const res = await withAuthOnlyApi({}, async (ctx) => ({
      uid: ctx.uid,
      email: ctx.email,
      keys: Object.keys(ctx).sort(),
    }))(get());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { uid: string; email: string; keys: string[] };
    expect(json.uid).toBe(uid);
    expect(json.keys).not.toContain("organizationId");
    expect(json.keys).not.toContain("role");
  });

  it("still returns 401 without a session and applies csrf, schema and rate limit", async () => {
    const schema = z.object({ a: z.string() });
    const h = withAuthOnlyApi({ schema, rateLimit: { name: `ao-${randomUUID()}`, limit: 2, windowSec: 60 } }, async ({ body }) => ({ body }));
    expect((await h(post({ a: "x" }))).status).toBe(401);
    signIn(`uid-${randomUUID()}`);
    expect((await h(post({ a: "x" }, { "content-type": "application/json", origin: "https://evil.com" }))).status).toBe(403);
    await withPinnedRateWindow(async () => {
      expect((await h(post({ a: 1 }))).status).toBe(400); // counts toward the limit (1 of 2)
      expect((await h(post({ a: "x" }))).status).toBe(200);
      expect((await h(post({ a: "x" }))).status).toBe(429);
    });
  });
});

describe("withApi: permission is mandatory", () => {
  it("omitting permission is a compile-time error", () => {
    // @ts-expect-error `permission` is required; use "any-member" to opt out explicitly
    const handler = withApi({}, async () => ({}));
    expect(typeof handler).toBe("function");
  });

  it('"any-member" lets a viewer through', async () => {
    const { uid } = await seedMember("viewer");
    signIn(uid);
    const res = await withApi({ permission: "any-member" }, async ({ role }) => ({ role }))(post({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "viewer" });
  });

  it("a real permission still denies a viewer (403 FORBIDDEN)", async () => {
    const { uid } = await seedMember("viewer");
    signIn(uid);
    const res = await withApi({ permission: "products:write" }, async () => ({}))(post({}));
    expect(res.status).toBe(403);
    expect((await errorOf(res)).message).toBe("You do not have permission to perform this action");
  });

  it("an unknown permission string at runtime denies everyone, even an owner", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const fn = vi.fn(async () => ({}));
    const res = await withApi({ permission: "nope:nothing" as never }, fn)(get());
    expect(res.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
  });

  it("no-membership 403 is distinct from permission 403", async () => {
    signIn(`uid-${randomUUID()}`);
    const noMember = await withApi({ permission: "any-member" }, async () => ({}))(get());
    expect(noMember.status).toBe(403);
    const noMemberMsg = (await errorOf(noMember)).message;
    expect(noMemberMsg).toBe("No organization membership");

    const { uid } = await seedMember("viewer");
    signIn(uid);
    const denied = await withApi({ permission: "customers:write" }, async () => ({}))(get());
    expect(denied.status).toBe(403);
    expect((await errorOf(denied)).message).not.toBe(noMemberMsg);
  });
});

describe("withApi: Next.js control-flow errors", () => {
  function nextError(digest: unknown): Error {
    return Object.assign(new Error("control flow"), { digest });
  }

  it.each(["NEXT_REDIRECT;replace;/login;307;", "NEXT_HTTP_ERROR_FALLBACK;404", "NEXT_NOT_FOUND", "DYNAMIC_SERVER_USAGE"])(
    "rethrows an error with digest %s unchanged (no 500 envelope)",
    async (digest) => {
      const { uid } = await seedMember("owner");
      signIn(uid);
      const thrown = nextError(digest);
      const spy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
      await expect(
        withApi({ permission: "any-member" }, async () => {
          throw thrown;
        })(get()),
      ).rejects.toBe(thrown);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    },
  );

  it.each([["SOMETHING_ELSE"], [42], [undefined]])("an error with digest %j still becomes the generic 500", async (digest) => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const spy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const res = await withApi({ permission: "any-member" }, async () => {
      throw nextError(digest);
    })(get());
    expect(res.status).toBe(500);
    expect((await errorOf(res)).code).toBe("INTERNAL_ERROR");
    spy.mockRestore();
  });

  it("a thrown Response is not control flow: generic 500", async () => {
    const { uid } = await seedMember("owner");
    signIn(uid);
    const spy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const res = await withApi({ permission: "any-member" }, async () => {
      throw Response.json({ leaked: "yes" }, { status: 200 });
    })(get());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("leaked");
    spy.mockRestore();
  });
});

describe("AuthOnlyContext", () => {
  it("has no organizationId or role property (compile-time)", async () => {
    await withAuthOnlyApi({}, async (ctx) => {
      // @ts-expect-error organizationId is not available without membership
      void ctx.organizationId;
      // @ts-expect-error role is not available without membership
      void ctx.role;
      return {};
    });
    expect(true).toBe(true);
  });
});
