import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/security/permissions";

import { GET, POST } from "./route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

const BASE = "http://localhost/api/categories";
const orgs = new Set<string>();
const uids: string[] = [];

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
function send(method: string, body?: unknown): Request {
  const raw =
    body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  const h = new Headers(body === undefined ? {} : { "content-type": "application/json" });
  if (raw !== undefined) h.set("content-length", String(Buffer.byteLength(raw)));
  return new Request(BASE, { method, headers: h, body: raw });
}
const post = (body: unknown) => POST(send("POST", body));
const list = () => GET(send("GET"));

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as Json;

beforeEach(() => {
  session = null;
});

afterAll(async () => {
  const db = adminDb();
  for (const org of orgs) {
    for (const col of ["categories", "categoryNames", "auditLogs"]) {
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

describe("/api/categories", () => {
  it("401 without a session, 403 without membership", async () => {
    expect((await list()).status).toBe(401);
    expect((await post({ name: "A" })).status).toBe(401);
    signIn(`uid-${randomUUID()}`);
    expect((await list()).status).toBe(403);
  });

  it("owner and admin create (201); agent and viewer cannot but can list", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const res = await post({ name: "Shirts", description: "All shirts", organizationId: "evil" });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await json(res)).toMatchObject({
      name: "Shirts",
      description: "All shirts",
      organizationId: owner.organizationId,
    });

    const admin = await seed("admin", owner.organizationId);
    signIn(admin.uid);
    expect((await post({ name: "Pants" })).status).toBe(201);

    for (const role of ["agent", "viewer"] as const) {
      const member = await seed(role, owner.organizationId);
      signIn(member.uid);
      expect((await post({ name: `Nope ${role}` })).status).toBe(403);
      const listed = await list();
      expect(listed.status).toBe(200);
      expect((await json(listed)).items.map((c: Json) => c.name)).toEqual(["Pants", "Shirts"]);
    }
  });

  it("409 for a duplicate name regardless of case and spacing", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    expect((await post({ name: "Summer Wear" })).status).toBe(201);
    for (const name of ["summer wear", "  SUMMER   WEAR "]) {
      const res = await post({ name });
      expect(res.status, name).toBe(409);
    }
  });

  it("400 for invalid bodies", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    for (const body of [
      {},
      { name: "" },
      { name: "  " },
      { name: "x".repeat(81) },
      { name: "a", description: "d".repeat(501) },
      "{bad",
    ]) {
      expect((await post(body)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
  });

  it("lists only the caller's organization", async () => {
    const a = await seed("owner");
    const b = await seed("owner");
    signIn(a.uid);
    await post({ name: "Mine" });
    signIn(b.uid);
    await post({ name: "Theirs" });
    expect((await json(await list())).items.map((c: Json) => c.name)).toEqual(["Theirs"]);
  });
});
