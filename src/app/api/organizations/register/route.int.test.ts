import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getMe } from "@/app/api/me/route";
import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";

import { POST } from "./route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

const uids: string[] = [];
const orgIds = new Set<string>();

function signIn(email: string | null = "owner@example.com"): string {
  const uid = `uid-${randomUUID()}`;
  uids.push(uid);
  session = { uid, email };
  return uid;
}

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return POST(
    new Request("http://localhost/api/organizations/register", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(raw)), ...headers },
      body: raw,
    }),
  );
}
const valid = { organizationName: "Acme", displayName: "Jo" };

beforeEach(() => {
  session = null;
});

afterAll(async () => {
  const db = adminDb();
  for (const uid of uids) {
    const owned = await db.collection("organizations").where("ownerUid", "==", uid).get();
    owned.docs.forEach((d) => orgIds.add(d.id));
  }
  await Promise.all([
    ...uids.map((u) => db.collection("users").doc(u).delete()),
    ...[...orgIds].flatMap((o) => [
      db.collection("organizations").doc(o).delete(),
      ...uids.map((u) => db.collection("organizationMembers").doc(`${o}_${u}`).delete()),
      db
        .collection("auditLogs")
        .where("organizationId", "==", o)
        .get()
        .then((s) => Promise.all(s.docs.map((d) => d.ref.delete()))),
    ]),
  ]);
});

describe("POST /api/organizations/register", () => {
  it("401 without a session", async () => {
    expect((await post(valid)).status).toBe(401);
  });

  it("201 creates the organization, then 200 with the same id; /api/me reflects the membership", async () => {
    const uid = signIn("owner@example.com");
    const meBefore = await getMe(new Request("http://localhost/api/me"));
    expect(meBefore.status).toBe(403);

    const first = await post(valid);
    expect(first.status).toBe(201);
    const a = (await first.json()) as { organizationId: string; created: boolean };
    orgIds.add(a.organizationId);
    expect(a.created).toBe(true);
    expect(first.headers.get("x-request-id")).toBeTruthy();
    expect(first.headers.get("cache-control")).toBe("no-store");

    const second = await post(valid);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ organizationId: a.organizationId, created: false });

    const me = await getMe(new Request("http://localhost/api/me"));
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ uid, email: "owner@example.com", organizationId: a.organizationId, role: "owner" });
  });

  it("takes uid and email from the session, ignoring any in the body", async () => {
    const uid = signIn("real@example.com");
    const res = await post({ ...valid, uid: "victim", email: "victim@example.com", organizationId: "other" });
    expect(res.status).toBe(201);
    const { organizationId } = (await res.json()) as { organizationId: string };
    orgIds.add(organizationId);
    const org = (await adminDb().collection("organizations").doc(organizationId).get()).data()!;
    expect(org.ownerUid).toBe(uid);
    expect((await adminDb().collection("users").doc("victim").get()).exists).toBe(false);
    const member = (await adminDb().collection("organizationMembers").doc(`${organizationId}_${uid}`).get()).data()!;
    expect(member.email).toBe("real@example.com");
  });

  it("400 on invalid input, 415 on text/plain, 403 cross-origin", async () => {
    signIn();
    expect((await post({ organizationName: "A", displayName: "Jo" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify(valid), { "content-type": "text/plain" })).status).toBe(415);
    expect((await post(valid, { origin: "https://evil.com" })).status).toBe(403);
  });

  it("403 when the session has no email", async () => {
    signIn(null);
    expect((await post(valid)).status).toBe(403);
  });

  it("is rate limited to 5 requests per minute per user", async () => {
    signIn();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await post(valid)).status);
    expect(statuses.slice(0, 5)).toEqual([201, 200, 200, 200, 200]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    const owned = await adminDb().collection("organizations").where("ownerUid", "==", session!.uid).get();
    expect(owned.size).toBe(1);
  });
});

describe("GET /api/me", () => {
  it("401 without a session", async () => {
    expect((await getMe(new Request("http://localhost/api/me"))).status).toBe(401);
  });
});
