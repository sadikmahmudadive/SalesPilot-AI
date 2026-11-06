import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { adminDb } from "@/lib/firebase/admin";

import { getOrganization, getUserDisplayName, ORGANIZATIONS, USERS } from "./organizations";

const orgIds: string[] = [];
const userIds: string[] = [];

afterAll(async () => {
  const db = adminDb();
  await Promise.all([
    ...orgIds.map((id) => db.collection(ORGANIZATIONS).doc(id).delete()),
    ...userIds.map((id) => db.collection(USERS).doc(id).delete()),
  ]);
});

describe("getOrganization", () => {
  it("returns the id and name of an existing organization", async () => {
    const id = `org-${randomUUID()}`;
    orgIds.push(id);
    await adminDb().collection(ORGANIZATIONS).doc(id).set({ name: "Acme Traders", ownerUid: "u1" });
    expect(await getOrganization(id)).toEqual({ id, name: "Acme Traders" });
  });

  it("returns null for a missing organization, a nameless one, and invalid ids", async () => {
    expect(await getOrganization(`org-${randomUUID()}`)).toBeNull();
    const id = `org-${randomUUID()}`;
    orgIds.push(id);
    await adminDb().collection(ORGANIZATIONS).doc(id).set({ ownerUid: "u1" });
    expect(await getOrganization(id)).toBeNull();
    expect(await getOrganization("")).toBeNull();
    expect(await getOrganization("a/b")).toBeNull();
  });
});

describe("getUserDisplayName", () => {
  it("returns the trimmed display name or null", async () => {
    const uid = `uid-${randomUUID()}`;
    userIds.push(uid);
    await adminDb().collection(USERS).doc(uid).set({ uid, displayName: "  Ada Lovelace " });
    expect(await getUserDisplayName(uid)).toBe("Ada Lovelace");
    const blank = `uid-${randomUUID()}`;
    userIds.push(blank);
    await adminDb().collection(USERS).doc(blank).set({ uid: blank, displayName: "  " });
    expect(await getUserDisplayName(blank)).toBeNull();
    expect(await getUserDisplayName(`uid-${randomUUID()}`)).toBeNull();
    expect(await getUserDisplayName("a/b")).toBeNull();
  });
});
