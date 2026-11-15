import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/security/permissions";
import { withPinnedRateWindow } from "@/test/pin-clock";

import { GET as GET_ONE, PATCH } from "./[id]/route";
import { GET, POST } from "./route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

const BASE = "http://localhost/api/agents";
const orgs = new Set<string>();
const uids: string[] = [];
let counter = 0;

async function seed(role: Role, organizationId = `org-${randomUUID()}`) {
  const uid = `uid-${randomUUID()}`;
  const db = adminDb();
  await db
    .collection("users")
    .doc(uid)
    .set({ uid, email: `${uid}@x.com`, defaultOrganizationId: organizationId });
  await db
    .collection("organizationMembers")
    .doc(`${organizationId}_${uid}`)
    .set({ organizationId, uid, role });
  orgs.add(organizationId);
  uids.push(uid);
  return { uid, organizationId };
}
const signIn = (uid: string) => {
  session = { uid, email: `${uid}@x.com` };
};

function send(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  const raw =
    body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  const h = new Headers(body === undefined ? {} : { "content-type": "application/json" });
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  if (raw !== undefined) h.set("content-length", String(Buffer.byteLength(raw)));
  return new Request(url, { method, headers: h, body: raw });
}
const post = (body: unknown, headers?: Record<string, string>) =>
  POST(send("POST", BASE, body, headers));
const list = (qs = "") => GET(send("GET", `${BASE}${qs ? `?${qs}` : ""}`));
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const getOne = (id: string) => GET_ONE(send("GET", `${BASE}/${id}`), idCtx(id));
const patchOne = (id: string, body: unknown, headers?: Record<string, string>) =>
  PATCH(send("PATCH", `${BASE}/${id}`, body, headers), idCtx(id));
const valid = (over: Record<string, unknown> = {}) => ({
  name: `Agent ${++counter}`,
  role: "retail_sales",
  ...over,
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as Json;

beforeEach(() => {
  session = null;
});

afterAll(async () => {
  const db = adminDb();
  for (const org of orgs) {
    for (const col of ["agents", "auditLogs"]) {
      const snap = await db.collection(col).where("organizationId", "==", org).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  }
  await Promise.all(
    uids.flatMap((u) => [
      db.collection("users").doc(u).delete(),
      ...[...orgs].map((o) => db.collection("organizationMembers").doc(`${o}_${u}`).delete()),
    ]),
  );
});

describe("authentication and permissions", () => {
  it("401 without a session on every method", async () => {
    expect((await list()).status).toBe(401);
    expect((await post(valid())).status).toBe(401);
    expect((await getOne("x")).status).toBe(401);
    expect((await patchOne("x", { name: "A" })).status).toBe(401);
  });

  it("403 for a user without membership", async () => {
    signIn(`uid-${randomUUID()}`);
    expect((await list()).status).toBe(403);
  });

  it("viewer can read but not create or patch", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const created = await json(await post(valid()));
    const viewer = await seed("viewer", owner.organizationId);
    signIn(viewer.uid);
    expect((await list()).status).toBe(200);
    expect((await getOne(created.id)).status).toBe(200);
    expect((await post(valid())).status).toBe(403);
    expect((await patchOne(created.id, { name: "Nope" })).status).toBe(403);
    expect((await getOne(created.id).then(json)).name).toBe(created.name);
  });

  it("role agent can read but neither create nor patch (agents:write is admin and above)", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const created = await json(await post(valid()));
    const agent = await seed("agent", owner.organizationId);
    signIn(agent.uid);
    expect((await post(valid())).status).toBe(403);
    expect((await patchOne(created.id, { name: "Nope" })).status).toBe(403);
    expect((await list()).status).toBe(200);
    expect((await getOne(created.id)).status).toBe(200);
  });

  it("admin can create and patch", async () => {
    const admin = await seed("admin");
    signIn(admin.uid);
    const res = await post(valid({ name: "By Admin" }));
    expect(res.status).toBe(201);
    const a = await json(res);
    expect((await patchOne(a.id, { description: "x" })).status).toBe(200);
  });
});

describe("POST /api/agents", () => {
  it("201 with the agent, no-store and a request id; organizationId comes from membership", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const res = await post({
      ...valid(),
      organizationId: "evil",
      version: 99,
      createdBy: "someone-else",
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const a = await json(res);
    expect(a).toMatchObject({
      organizationId: owner.organizationId,
      version: 1,
      createdBy: owner.uid,
      status: "inactive",
      channels: ["test"],
    });
    expect(a).not.toHaveProperty("nameLower");
  });

  it("400 invalid JSON / invalid fields, 415 text/plain, 403 cross-origin", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    expect((await post("not json")).status).toBe(400);
    expect((await post({ name: "", role: "nope" })).status).toBe(400);
    expect((await post(JSON.stringify(valid()), { "content-type": "text/plain" })).status).toBe(
      415,
    );
    expect((await post(valid(), { origin: "https://evil.com" })).status).toBe(403);
  });

  it("400 for a category that belongs to no category of the caller's organization", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const res = await post(
      valid({ productAccess: { mode: "categories", categoryIds: ["not-a-real-category"] } }),
    );
    expect(res.status).toBe(400);
  });

  it("is rate limited to 30 creates per minute per user (31st -> 429)", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const statuses: number[] = [];
    await withPinnedRateWindow(async () => {
      for (let i = 0; i < 31; i++) statuses.push((await post(valid())).status);
    });
    expect(statuses.slice(0, 30).every((s) => s === 201)).toBe(true);
    expect(statuses[30]).toBe(429);
  }, 120_000);
});

describe("GET /api/agents", () => {
  it("lists with pagination, scoped to the caller's organization", async () => {
    const owner = await seed("owner");
    const other = await seed("owner");
    signIn(other.uid);
    await post(valid({ name: "Foreign" }));
    signIn(owner.uid);
    for (const n of ["Bravo", "Alpha", "Charlie"]) await post(valid({ name: n }));

    const page1 = await json(await list("limit=2"));
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await json(await list(`limit=2&cursor=${page1.nextCursor}`));
    const names = [...page1.items, ...page2.items].map((a: Json) => a.name);
    expect(names.sort()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(page2.nextCursor).toBeNull();
    for (const a of [...page1.items, ...page2.items]) expect(a).not.toHaveProperty("nameLower");
  });

  it("400 for a bad cursor, limit 0/51, repeated limit; unknown params ignored", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    expect((await list("cursor=%21%21bad")).status).toBe(400);
    expect((await list("limit=0")).status).toBe(400);
    expect((await list("limit=51")).status).toBe(400);
    expect((await list("limit=abc")).status).toBe(400);
    expect((await list("limit=5&limit=6")).status).toBe(400);
    expect((await list("limit=50&whatever=1")).status).toBe(200);
  });
});

describe("GET/PATCH /api/agents/[id]", () => {
  it("round trip: get, patch bumps the version only for behaviour fields", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const a = await json(await post(valid({ name: "Round Trip" })));
    expect(a.version).toBe(1);

    const got = await json(await getOne(a.id));
    expect(got.id).toBe(a.id);
    expect(got).not.toHaveProperty("nameLower");

    // Non-behaviour field: version stays.
    const renamed = await json(await patchOne(a.id, { name: "Renamed", status: "active" }));
    expect(renamed).toMatchObject({ name: "Renamed", status: "active", version: 1 });

    // Behaviour field: version bumps.
    const instructed = await json(await patchOne(a.id, { instructions: "Be kind" }));
    expect(instructed).toMatchObject({ instructions: "Be kind", version: 2, name: "Renamed" });

    // Same value again: no bump.
    const same = await json(await patchOne(a.id, { instructions: "Be kind" }));
    expect(same.version).toBe(2);

    // model: null clears the field.
    await patchOne(a.id, { model: "some-model" });
    const cleared = await json(await patchOne(a.id, { model: null }));
    expect(cleared).not.toHaveProperty("model");
  });

  it("404 across organizations for get and patch (and nothing changes)", async () => {
    const a = await seed("owner");
    const b = await seed("owner");
    signIn(a.uid);
    const created = await json(await post(valid({ name: "Mine" })));
    signIn(b.uid);
    expect((await getOne(created.id)).status).toBe(404);
    expect((await patchOne(created.id, { name: "Hacked" })).status).toBe(404);
    signIn(a.uid);
    expect((await json(await getOne(created.id))).name).toBe("Mine");
  });

  it("404 (not 400) for invalid ids such as ones containing /", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    for (const id of ["a/b", "..", "__x__", "x".repeat(2000)]) {
      expect((await getOne(id)).status, id.slice(0, 10)).toBe(404);
      expect((await patchOne(id, { name: "x" })).status).toBe(404);
    }
  });

  it("PATCH validation: 400 on an empty patch or bad value, 415, 403 cross-origin", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const a = await json(await post(valid({ name: "Keep" })));
    expect((await patchOne(a.id, {})).status).toBe(400);
    expect((await patchOne(a.id, { status: "nope" })).status).toBe(400);
    expect(
      (await patchOne(a.id, JSON.stringify({ name: "x" }), { "content-type": "text/plain" }))
        .status,
    ).toBe(415);
    expect((await patchOne(a.id, { name: "x" }, { origin: "https://evil.com" })).status).toBe(403);
    expect((await json(await getOne(a.id))).name).toBe("Keep");
  });
});
