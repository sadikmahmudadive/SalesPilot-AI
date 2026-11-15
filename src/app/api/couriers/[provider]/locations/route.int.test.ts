import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/security/permissions";
import { createCourierAccount } from "@/repositories/couriers";
import { GET } from "./route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

const orgs = new Set<string>();

async function seed(role: Role = "agent") {
  const organizationId = `org-${randomUUID()}`;
  const uid = `uid-${randomUUID()}`;
  const db = adminDb();
  await db
    .collection("users")
    .doc(uid)
    .set({ uid, email: `${uid}@test.com`, defaultOrganizationId: organizationId });
  await db
    .collection("organizationMembers")
    .doc(`${organizationId}_${uid}`)
    .set({ organizationId, uid, role });
  orgs.add(organizationId);
  return { uid, organizationId };
}

const signIn = (uid: string) => {
  session = { uid, email: `${uid}@test.com` };
};

describe("Courier Locations API route", () => {
  beforeEach(() => {
    session = null;
  });

  afterAll(async () => {
    const db = adminDb();
    for (const orgId of orgs) {
      const snap = await db.collection("courierLocations").get();
      for (const d of snap.docs) {
        if (d.id.startsWith(orgId)) await d.ref.delete();
      }
    }
  });

  it("returns 200 with locations for authenticated agent", async () => {
    const { uid, organizationId } = await seed("agent");
    signIn(uid);

    await createCourierAccount({
      organizationId,
      provider: "mock",
      label: "Mock Logistics",
      mode: "mock",
      enabled: true,
      isDefault: true,
      credentials: { v: 1, iv: "iv", tag: "tag", data: "data" },
      publicConfig: {},
    });

    const req = new Request("http://localhost/api/couriers/mock/locations?level=city");
    const res = await GET(req, { params: Promise.resolve({ provider: "mock" }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.items).toEqual([
      { id: "1", name: "Dhaka" },
      { id: "2", name: "Chittagong" },
    ]);
  });

  it("returns 400 for unknown courier provider", async () => {
    const { uid } = await seed("agent");
    signIn(uid);

    const req = new Request("http://localhost/api/couriers/invalid/locations");
    const res = await GET(req, { params: Promise.resolve({ provider: "invalid" }) });
    expect(res.status).toBe(400);
  });
});
