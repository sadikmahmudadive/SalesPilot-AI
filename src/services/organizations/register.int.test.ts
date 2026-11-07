import { randomUUID } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import { adminDb } from "@/lib/firebase/admin";
import { writeAuditInTransaction } from "@/lib/security/audit";
import { getMembership } from "@/repositories/organizations";

import { registerOrganization } from "./register";

const uids: string[] = [];
const orgIds = new Set<string>();

function newUid(): string {
  const uid = `uid-${randomUUID()}`;
  uids.push(uid);
  return uid;
}
const input = (uid: string) => ({
  uid,
  email: `${uid}@example.com`,
  displayName: "Jo Owner",
  organizationName: "Acme",
});

async function auditRowsBy(uid: string) {
  return adminDb().collection("auditLogs").where("actorUid", "==", uid).get();
}

async function orgsOwnedBy(uid: string) {
  return adminDb().collection("organizations").where("ownerUid", "==", uid).get();
}

afterAll(async () => {
  const db = adminDb();
  for (const uid of uids) {
    const owned = await orgsOwnedBy(uid);
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

describe("registerOrganization", () => {
  it("creates user, organization, owner membership and an audit entry", async () => {
    const uid = newUid();
    const { organizationId, created } = await registerOrganization(input(uid));
    orgIds.add(organizationId);
    expect(created).toBe(true);
    const db = adminDb();

    const user = (await db.collection("users").doc(uid).get()).data()!;
    expect(user).toMatchObject({
      uid,
      email: `${uid}@example.com`,
      displayName: "Jo Owner",
      defaultOrganizationId: organizationId,
    });
    expect(user.createdAt).toBeInstanceOf(Timestamp);

    const org = (await db.collection("organizations").doc(organizationId).get()).data()!;
    expect(org).toMatchObject({ name: "Acme", ownerUid: uid });
    expect(org.createdAt).toBeInstanceOf(Timestamp);

    const member = (
      await db.collection("organizationMembers").doc(`${organizationId}_${uid}`).get()
    ).data()!;
    expect(member).toMatchObject({
      organizationId,
      uid,
      role: "owner",
      email: `${uid}@example.com`,
    });
    expect(member.createdAt).toBeInstanceOf(Timestamp);

    const audit = await db
      .collection("auditLogs")
      .where("organizationId", "==", organizationId)
      .get();
    expect(audit.size).toBe(1);
    expect(audit.docs[0]!.data()).toMatchObject({
      action: "organization.create",
      actorUid: uid,
      resource: "organization",
      resourceId: organizationId,
    });
    expect(await getMembership(uid)).toEqual({ organizationId, role: "owner" });
  });

  it("is idempotent per uid: second call returns the same org and creates nothing", async () => {
    const uid = newUid();
    const first = await registerOrganization(input(uid));
    orgIds.add(first.organizationId);
    const second = await registerOrganization({ ...input(uid), organizationName: "Other name" });
    expect(second).toEqual({ organizationId: first.organizationId, created: false });
    expect((await orgsOwnedBy(uid)).size).toBe(1);
    const audit = await adminDb()
      .collection("auditLogs")
      .where("organizationId", "==", first.organizationId)
      .get();
    expect(audit.size).toBe(1);
    const org = (
      await adminDb().collection("organizations").doc(first.organizationId).get()
    ).data()!;
    expect(org.name).toBe("Acme");
  });

  it("5 parallel calls for one uid create exactly one organization", async () => {
    const uid = newUid();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => registerOrganization(input(uid))),
    );
    const ids = new Set(results.map((r) => r.organizationId));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect((await orgsOwnedBy(uid)).size).toBe(1);
    const orgId = [...ids][0]!;
    orgIds.add(orgId);
    const audit = await adminDb()
      .collection("auditLogs")
      .where("organizationId", "==", orgId)
      .get();
    expect(audit.size).toBe(1);
  });

  it("different uids get different organizations", async () => {
    const a = await registerOrganization(input(newUid()));
    const b = await registerOrganization(input(newUid()));
    orgIds.add(a.organizationId);
    orgIds.add(b.organizationId);
    expect(a.organizationId).not.toBe(b.organizationId);
  });

  it("rolls back everything when a write in the transaction fails", async () => {
    const uid = newUid();
    const db = adminDb();
    let attempted = 0;
    await expect(
      registerOrganization(input(uid), {
        writeAudit: (tx, entry) => {
          attempted++;
          // The user, organization and member writes are already buffered in the transaction here.
          expect(entry.organizationId).toBeTruthy();
          writeAuditInTransaction(tx, entry); // the audit row is buffered too, then the failure hits
          throw new Error("injected failure");
        },
      }),
    ).rejects.toThrow("injected failure");
    expect(attempted).toBe(1);
    expect((await db.collection("users").doc(uid).get()).exists).toBe(false);
    expect((await orgsOwnedBy(uid)).empty).toBe(true);
    const members = await db.collection("organizationMembers").where("uid", "==", uid).get();
    expect(members.empty).toBe(true);
    expect((await auditRowsBy(uid)).empty).toBe(true);
    expect(await getMembership(uid)).toBeNull();
  });

  it("rolls back when the commit itself is rejected by Firestore", async () => {
    const uid = newUid();
    const db = adminDb();
    await expect(
      registerOrganization(input(uid), {
        // Buffers a write Firestore refuses at commit time (document exceeds the 1 MiB limit).
        writeAudit: (tx, entry) => {
          writeAuditInTransaction(tx, entry); // a valid audit row is buffered before the oversized write
          tx.set(db.collection("rollbackProbe").doc(uid), { blob: "x".repeat(1_100_000) });
        },
      }),
    ).rejects.toThrow(/INVALID_ARGUMENT.*longer than/);
    expect((await db.collection("users").doc(uid).get()).exists).toBe(false);
    expect((await orgsOwnedBy(uid)).empty).toBe(true);
    expect((await db.collection("rollbackProbe").doc(uid).get()).exists).toBe(false);
    expect((await auditRowsBy(uid)).empty).toBe(true);
    expect((await db.collection("organizationMembers").where("uid", "==", uid).get()).empty).toBe(
      true,
    );
  });

  it("rejects invalid input without writing", async () => {
    const uid = newUid();
    await expect(
      registerOrganization({ ...input(uid), organizationName: "" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(registerOrganization({ ...input(""), uid: "" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect((await adminDb().collection("users").doc(uid).get()).exists).toBe(false);
  });
});

describe("getMembership", () => {
  it("returns null for an unknown user, a user without membership, and an unknown org", async () => {
    expect(await getMembership(`nobody-${randomUUID()}`)).toBeNull();
    const uid = newUid();
    const { organizationId } = await registerOrganization(input(uid));
    orgIds.add(organizationId);
    expect(await getMembership(uid, "some-other-org")).toBeNull();
    expect(await getMembership(uid, "a/b")).toBeNull();
    expect(await getMembership("", undefined)).toBeNull();
  });

  it("is not satisfied by defaultOrganizationId alone (member doc is the authority)", async () => {
    const uid = newUid();
    await adminDb().collection("users").doc(uid).set({ uid, defaultOrganizationId: "ghost-org" });
    expect(await getMembership(uid)).toBeNull();
  });

  it("fails closed on an unknown role string or mismatched member doc", async () => {
    const db = adminDb();
    const uid = newUid();
    const org = `org-${randomUUID()}`;
    await db.collection("users").doc(uid).set({ uid, defaultOrganizationId: org });
    const ref = db.collection("organizationMembers").doc(`${org}_${uid}`);
    await ref.set({ organizationId: org, uid, role: "superadmin" });
    expect(await getMembership(uid)).toBeNull();
    await ref.set({ organizationId: org, uid, role: "__proto__" });
    expect(await getMembership(uid)).toBeNull();
    await ref.set({ organizationId: org, uid, role: "viewer" });
    expect(await getMembership(uid)).toEqual({ organizationId: org, role: "viewer" });
    await ref.set({ organizationId: "different", uid, role: "viewer" });
    expect(await getMembership(uid)).toBeNull();
    await ref.delete();
  });
});
