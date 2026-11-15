import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/security/permissions";
import { getCourierAccount } from "@/repositories/couriers";

import { DELETE, GET as GET_ONE, PATCH } from "./[id]/route";
import { POST as TEST_CONNECTION } from "./[id]/test/route";
import { GET, POST } from "./route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

const TEST_KEY = Buffer.alloc(32, 1).toString("base64");
const origKey = process.env.ENCRYPTION_KEY;
process.env.ENCRYPTION_KEY = TEST_KEY;

const orgs = new Set<string>();

async function seed(role: Role = "owner") {
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

function req(method: string, url: string, body?: unknown): Request {
  const raw = body === undefined ? undefined : JSON.stringify(body);
  const headers = new Headers(body === undefined ? {} : { "content-type": "application/json" });
  if (raw !== undefined) headers.set("content-length", String(Buffer.byteLength(raw)));
  return new Request(url, { method, headers, body: raw });
}

describe("Courier Accounts API", () => {
  beforeEach(() => {
    session = null;
  });

  afterAll(async () => {
    const db = adminDb();
    for (const orgId of orgs) {
      const snap = await db.collection("courierAccounts").where("organizationId", "==", orgId).get();
      const batch = db.batch();
      for (const d of snap.docs) batch.delete(d.ref);
      await batch.commit();
    }
    if (origKey !== undefined) process.env.ENCRYPTION_KEY = origKey;
    else delete process.env.ENCRYPTION_KEY;
  });

  it("lists, creates, updates, tests, and deletes courier accounts", async () => {
    const { uid, organizationId } = await seed("owner");
    signIn(uid);

    // 1. Initially empty
    const listRes1 = await GET(req("GET", "http://localhost/api/integrations/couriers"));
    expect(listRes1.status).toBe(200);
    const json1 = await listRes1.json();
    expect(json1.items).toEqual([]);

    // 2. Create mock courier account
    const createRes = await POST(
      req("POST", "http://localhost/api/integrations/couriers", {
        provider: "mock",
        label: "Primary Mock Courier",
        mode: "mock",
        enabled: true,
        isDefault: true,
        credentials: {},
        webhookSecret: "secret_123",
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()).data;
    expect(created.id).toBeDefined();
    expect(created.label).toBe("Primary Mock Courier");
    expect(created.provider).toBe("mock");
    expect(created.isDefault).toBe(true);
    expect(created.hasCredentials).toBe(true);
    expect(created.hasWebhookSecret).toBe(true);
    expect(created.credentials).toBeUndefined(); // Secrets must not leak

    // 3. Get single account
    const getRes = await GET_ONE(
      req("GET", `http://localhost/api/integrations/couriers/${created.id}`),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()).data;
    expect(got.id).toBe(created.id);
    expect(got.label).toBe("Primary Mock Courier");

    // 4. Test connection
    const testRes = await TEST_CONNECTION(
      req("POST", `http://localhost/api/integrations/couriers/${created.id}/test`),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(testRes.status).toBe(200);
    const testJson = await testRes.json();
    expect(testJson.ok).toBe(true);

    // Verify lastTestedAt and lastTestResult updated in DB
    const accountInDb = await getCourierAccount(organizationId, created.id);
    expect(accountInDb?.lastTestResult).toBe("ok");
    expect(accountInDb?.lastTestedAt).toBeDefined();

    // 5. Update account
    const updateRes = await PATCH(
      req("PATCH", `http://localhost/api/integrations/couriers/${created.id}`, {
        label: "Updated Mock Courier",
        enabled: false,
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()).data;
    expect(updated.label).toBe("Updated Mock Courier");
    expect(updated.enabled).toBe(false);

    // 6. Delete account
    const delRes = await DELETE(
      req("DELETE", `http://localhost/api/integrations/couriers/${created.id}`),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(delRes.status).toBe(200);

    const deletedInDb = await getCourierAccount(organizationId, created.id);
    expect(deletedInDb).toBeNull();
  });
});
