import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/security/permissions";

import { DELETE, GET as GET_ONE, PATCH } from "./[id]/route";
import { GET, POST } from "./route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

const BASE = "http://localhost/api/customers";
const orgs = new Set<string>();
const uids: string[] = [];
let counter = 0;
const phone = () => `01713${String(1000000 + ++counter).slice(1)}`;
const RAHIM = String.fromCodePoint(0x09b0, 0x09b9, 0x09bf, 0x09ae);

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
const del = (id: string, headers?: Record<string, string>) =>
  DELETE(send("DELETE", `${BASE}/${id}`, undefined, headers), idCtx(id));
const valid = (over: Record<string, unknown> = {}) => ({
  fullName: `Cust ${counter + 1}`,
  phone: phone(),
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
    for (const col of ["customers", "customerPhones", "auditLogs"]) {
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
    expect((await patchOne("x", { fullName: "A" })).status).toBe(401);
    expect((await del("x")).status).toBe(401);
  });

  it("403 for a user without membership", async () => {
    signIn(`uid-${randomUUID()}`);
    expect((await list()).status).toBe(403);
  });

  it("viewer can read but not create, patch or delete", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const created = await json(await post(valid()));
    const viewer = await seed("viewer", owner.organizationId);
    signIn(viewer.uid);
    expect((await list()).status).toBe(200);
    expect((await getOne(created.id)).status).toBe(200);
    expect((await post(valid())).status).toBe(403);
    expect((await patchOne(created.id, { fullName: "Nope" })).status).toBe(403);
    expect((await del(created.id)).status).toBe(403);
    expect((await getOne(created.id).then(json)).fullName).toBe(created.fullName);
  });

  it("agent can create, patch and delete (customers:write)", async () => {
    const agent = await seed("agent");
    signIn(agent.uid);
    const res = await post(valid({ fullName: "By Agent" }));
    expect(res.status).toBe(201);
    const c = await json(res);
    expect((await patchOne(c.id, { segment: "interested" })).status).toBe(200);
    expect((await del(c.id)).status).toBe(204);
  });
});

describe("POST /api/customers", () => {
  it("201 with the customer, no-store and a request id; organizationId comes from membership", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const res = await post({
      ...valid({ phone: "01713-111222" }),
      organizationId: "evil",
      totalSpendMinor: 9,
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const c = await json(res);
    expect(c).toMatchObject({
      organizationId: owner.organizationId,
      phoneE164: "+8801713111222",
      totalSpendMinor: 0,
    });
    expect(c).not.toHaveProperty("fullNameLower");
  });

  it("409 for a duplicate phone, without leaking the other customer", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const first = await json(await post(valid({ phone: "01713222333" })));
    const res = await post(valid({ phone: "+8801713222333" }));
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error.code).toBe("CONFLICT");
    expect(JSON.stringify(body)).not.toContain(first.id);
  });

  it("400 invalid JSON / invalid fields, 415 text/plain, 403 cross-origin", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    expect((await post("not json")).status).toBe(400);
    expect((await post({ fullName: "", phone: "1" })).status).toBe(400);
    expect((await post(JSON.stringify(valid()), { "content-type": "text/plain" })).status).toBe(
      415,
    );
    expect((await post(valid(), { origin: "https://evil.com" })).status).toBe(403);
  });

  it("is rate limited to 60 creates per minute per user (61st -> 429)", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await post(valid())).status);
    expect(statuses.slice(0, 60).every((s) => s === 201)).toBe(true);
    expect(statuses[60]).toBe(429);
  }, 120_000);
});

describe("GET /api/customers", () => {
  it("lists with pagination and search, scoped to the caller's organization", async () => {
    const owner = await seed("owner");
    const other = await seed("owner");
    signIn(other.uid);
    await post(valid({ fullName: "Foreign Rahim" }));
    signIn(owner.uid);
    for (const n of ["Bravo", "Alpha", "Charlie"]) await post(valid({ fullName: n }));
    await post(valid({ fullName: `${RAHIM} Khan`, phone: "01913000001" }));

    const page1 = await json(await list("sort=fullName&limit=2"));
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await json(await list(`sort=fullName&limit=2&cursor=${page1.nextCursor}`));
    const names = [...page1.items, ...page2.items].map((c: Json) => c.fullName);
    expect(names).toHaveLength(4);
    expect(names).not.toContain("Foreign Rahim");
    expect(page2.nextCursor).toBeNull();

    expect((await json(await list(`q=${encodeURIComponent(RAHIM)}`))).items).toHaveLength(1);
    expect((await json(await list("q=alp"))).items.map((c: Json) => c.fullName)).toEqual(["Alpha"]);
    expect((await json(await list("q=0191"))).items).toHaveLength(1);
    expect((await json(await list("q=rahim"))).items).toHaveLength(0); // other org's customer is invisible
  });

  it("filters by segment, tag and type", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    await post(valid({ segment: "converted", tags: ["vip"], customerType: "wholesale" }));
    await post(valid({ segment: "inactive" }));
    expect((await json(await list("segment=converted"))).items).toHaveLength(1);
    expect((await json(await list("tag=vip"))).items).toHaveLength(1);
    expect((await json(await list("customerType=wholesale"))).items).toHaveLength(1);
    expect((await json(await list("customerType=retail"))).items).toHaveLength(1);
  });

  it("400 for two filters, search+filter, bad cursor, limit 0/51, repeated or invalid params; unknown params ignored", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    expect((await list("segment=converted&tag=vip")).status).toBe(400);
    expect((await list("q=jo&segment=converted")).status).toBe(400);
    expect((await list("cursor=%21%21bad")).status).toBe(400);
    expect((await list("limit=0")).status).toBe(400);
    expect((await list("limit=51")).status).toBe(400);
    expect((await list("segment=converted&segment=inactive")).status).toBe(400);
    expect((await list("sort=phone")).status).toBe(400);
    expect((await list(`q=${"a".repeat(65)}`)).status).toBe(400);
    expect((await list("limit=50&whatever=1")).status).toBe(200);
    const res = await list("segment=converted&tag=vip");
    expect((await json(res)).error.message).toBe("Use only one filter at a time");
  });
});

describe("GET/PATCH/DELETE /api/customers/[id]", () => {
  it("round trip: get, patch (null clears), delete 204 then 404", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const c = await json(
      await post(
        valid({
          email: "a@b.com",
          whatsappNumber: "01813000001",
          tags: ["x"],
          segment: "converted",
        }),
      ),
    );
    expect(c.whatsappE164).toBe("+8801813000001");

    const got = await json(await getOne(c.id));
    expect(got.id).toBe(c.id);

    const res = await patchOne(c.id, { email: null, whatsappNumber: null, fullName: "Renamed" });
    expect(res.status).toBe(200);
    const patched = await json(res);
    expect(patched).toMatchObject({ fullName: "Renamed", tags: ["x"], segment: "converted" });
    for (const k of ["email", "whatsappNumber", "whatsappE164"])
      expect(patched).not.toHaveProperty(k);

    const d = await del(c.id);
    expect(d.status).toBe(204);
    expect(await d.text()).toBe("");
    expect((await getOne(c.id)).status).toBe(404);
    expect((await del(c.id)).status).toBe(404);
  });

  it("404 across organizations for get, patch and delete (and nothing changes)", async () => {
    const a = await seed("owner");
    const b = await seed("owner");
    signIn(a.uid);
    const c = await json(await post(valid({ fullName: "Mine" })));
    signIn(b.uid);
    expect((await getOne(c.id)).status).toBe(404);
    expect((await patchOne(c.id, { fullName: "Hacked" })).status).toBe(404);
    expect((await del(c.id)).status).toBe(404);
    signIn(a.uid);
    expect((await json(await getOne(c.id))).fullName).toBe("Mine");
  });

  it("404 (not 400) for invalid ids such as ones containing /", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    for (const id of ["a/b", "..", "__x__", "x".repeat(2000)]) {
      expect((await getOne(id)).status, id.slice(0, 10)).toBe(404);
      expect((await patchOne(id, { fullName: "x" })).status).toBe(404);
      expect((await del(id)).status).toBe(404);
    }
  });

  it("PATCH validation: 400 on an empty patch or bad value, 409 on a phone owned by someone else, 415, 403 cross-origin", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const a = await json(await post(valid({ phone: "01713333001" })));
    await post(valid({ phone: "01713333002" }));
    expect((await patchOne(a.id, {})).status).toBe(400);
    expect((await patchOne(a.id, { segment: "nope" })).status).toBe(400);
    expect((await patchOne(a.id, { phone: "01713333002" })).status).toBe(409);
    expect(
      (await patchOne(a.id, JSON.stringify({ fullName: "x" }), { "content-type": "text/plain" }))
        .status,
    ).toBe(415);
    expect((await patchOne(a.id, { fullName: "x" }, { origin: "https://evil.com" })).status).toBe(
      403,
    );
    expect((await del(a.id, { origin: "https://evil.com" })).status).toBe(403);
    expect((await json(await getOne(a.id))).phoneE164).toBe("+8801713333001");
  });
});
