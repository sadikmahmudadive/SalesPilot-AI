import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";

import { GET } from "./route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

async function signInViewer() {
  const organizationId = `org-${randomUUID()}`;
  const uid = `uid-${randomUUID()}`;
  await adminDb()
    .collection("users")
    .doc(uid)
    .set({ uid, email: `${uid}@t.test`, defaultOrganizationId: organizationId });
  await adminDb()
    .collection("organizationMembers")
    .doc(`${organizationId}_${uid}`)
    .set({ organizationId, uid, role: "viewer" });
  session = { uid, email: `${uid}@t.test` };
}

const get = (q: string) =>
  GET(new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}`));

describe("GET /api/search", () => {
  beforeEach(() => {
    session = null;
  });

  it("requires a session", async () => {
    expect((await get("nadia")).status).toBe(401);
  });

  it("rejects a query shorter than 2 characters", async () => {
    await signInViewer();
    expect((await get("n")).status).toBe(400);
    expect((await get("  ")).status).toBe(400);
  });

  it("returns every group a viewer can read", async () => {
    await signInViewer();
    const res = await get("nadia");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["conversations", "customers", "orders", "products"]);
    expect(body.customers).toEqual([]);
  });
});
