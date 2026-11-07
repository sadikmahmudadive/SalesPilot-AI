import { randomUUID } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";

import { writeAudit, writeAuditInTransaction } from "./audit";

const orgId = `org-${randomUUID()}`;
const createdIds: string[] = [];

afterAll(async () => {
  await Promise.all(createdIds.map((id) => adminDb().collection("auditLogs").doc(id).delete()));
});

const base = {
  organizationId: orgId,
  actorUid: "uid-1",
  action: "product.update",
  resource: "product",
  resourceId: "p1",
};

describe("writeAudit", () => {
  it("writes the entry with a server timestamp and masks secrets", async () => {
    const id = await writeAudit({
      ...base,
      before: { token: "x", name: "a" },
      after: { name: "b" },
    });
    createdIds.push(id);
    const data = (await adminDb().collection("auditLogs").doc(id).get()).data()!;
    expect(data).toMatchObject({
      organizationId: orgId,
      actorUid: "uid-1",
      action: "product.update",
      resource: "product",
      resourceId: "p1",
      before: { token: "[REDACTED]", name: "a" },
      after: { name: "b" },
    });
    expect(data.createdAt).toBeInstanceOf(Timestamp);
    expect(Math.abs(data.createdAt.toMillis() - Date.now())).toBeLessThan(60_000);
  });

  it("omits undefined before/after", async () => {
    const id = await writeAudit(base);
    createdIds.push(id);
    const data = (await adminDb().collection("auditLogs").doc(id).get()).data()!;
    expect("before" in data).toBe(false);
    expect("after" in data).toBe(false);
  });

  it.each(["organizationId", "actorUid", "action", "resource", "resourceId"] as const)(
    "rejects an empty %s without writing",
    async (field) => {
      // organizationId and actorUid both carry the marker; query on whichever one is not
      // overridden so the "nothing written" assertion is never vacuous.
      const marker = `marker-${randomUUID()}`;
      const entry = { ...base, organizationId: marker, actorUid: marker, [field]: "  " };
      await expect(writeAudit(entry)).rejects.toBeInstanceOf(ValidationError);
      const probe = field === "organizationId" ? "actorUid" : "organizationId";
      const snap = await adminDb().collection("auditLogs").where(probe, "==", marker).get();
      expect(snap.empty).toBe(true);
    },
  );

  it("accepts the probe query (control: a valid entry with the marker is found)", async () => {
    const marker = `marker-${randomUUID()}`;
    const id = await writeAudit({ ...base, organizationId: marker, actorUid: marker });
    createdIds.push(id);
    const snap = await adminDb()
      .collection("auditLogs")
      .where("organizationId", "==", marker)
      .get();
    expect(snap.size).toBe(1);
  });
});

describe("writeAuditInTransaction", () => {
  it("commits the audit row with the transaction", async () => {
    const db = adminDb();
    const ref = db.collection("smokeAudit").doc(randomUUID());
    await db.runTransaction(async (tx) => {
      tx.set(ref, { v: 1 });
      writeAuditInTransaction(tx, { ...base, resourceId: ref.id, after: { password: "p" } });
    });
    await ref.delete();
    const snap = await db.collection("auditLogs").where("resourceId", "==", ref.id).get();
    expect(snap.size).toBe(1);
    createdIds.push(snap.docs[0]!.id);
    expect(snap.docs[0]!.data().after).toEqual({ password: "[REDACTED]" });
  });
});
