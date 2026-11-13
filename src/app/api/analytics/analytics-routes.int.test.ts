import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/security/permissions";

import { GET as GET_ANALYTICS } from "./route";
import { GET as GET_INTEGRATION_STATUS } from "../integrations/status/route";
import { GET as GET_AUDIT_LOGS } from "../audit-logs/route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

const db = () => adminDb();
const orgs: string[] = [];
const uids: string[] = [];

async function seedUser(role: Role = "owner", existingOrgId?: string) {
  const organizationId = existingOrgId ?? `org-${randomUUID()}`;
  if (!existingOrgId) orgs.push(organizationId);
  const uid = `uid-${randomUUID()}`;
  uids.push(uid);
  if (!existingOrgId) {
    await db().collection("organizations").doc(organizationId).set({
      id: organizationId,
      name: "Analytics Test Org",
      slug: `slug-${organizationId}`,
      ownerUid: uid,
      currency: "BDT",
      timezone: "Asia/Dhaka",
    });
  }
  await db()
    .collection("users")
    .doc(uid)
    .set({ uid, email: `${uid}@test.com`, defaultOrganizationId: organizationId });
  await db()
    .collection("organizationMembers")
    .doc(`${organizationId}_${uid}`)
    .set({ organizationId, uid, role });
  return { uid, organizationId };
}

afterAll(async () => {
  for (const org of orgs) {
    for (const col of [
      "organizations",
      "organizationMembers",
      "orders",
      "customers",
      "auditLogs",
    ]) {
      const snap = await db().collection(col).where("organizationId", "==", org).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    await db().collection("organizations").doc(org).delete().catch(() => undefined);
  }
  for (const uid of uids) {
    await db().collection("users").doc(uid).delete().catch(() => undefined);
  }
});

describe("Phase 8 API routes (integration)", () => {
  it("serves analytics report, platform integration status, and audit logs with RBAC", async () => {
    const owner = await seedUser("owner");
    const viewer = await seedUser("viewer", owner.organizationId);
    const otherOrg = await seedUser("owner");

    await db()
      .collection("orders")
      .doc(randomUUID())
      .set({
        organizationId: owner.organizationId,
        status: "delivered",
        source: "staff",
        paymentMethod: "online",
        paymentStatus: "paid",
        totalMinor: 120000,
        lines: [{ productId: "prod-1", productName: "Sneakers", quantity: 2, lineTotalMinor: 120000 }],
        createdAt: Timestamp.fromDate(new Date()),
      });

    await db()
      .collection("auditLogs")
      .doc(randomUUID())
      .set({
        organizationId: owner.organizationId,
        actorUid: owner.uid,
        action: "order.confirm",
        resource: "order",
        resourceId: "ord-123",
        createdAt: Timestamp.fromDate(new Date()),
      });

    await db()
      .collection("auditLogs")
      .doc(randomUUID())
      .set({
        organizationId: otherOrg.organizationId,
        actorUid: otherOrg.uid,
        action: "secret.other_org",
        resource: "order",
        resourceId: "ord-999",
        createdAt: Timestamp.fromDate(new Date()),
      });

    // Viewer can read analytics
    session = { uid: viewer.uid, email: `${viewer.uid}@test.com` };
    const analyticsRes = await GET_ANALYTICS(
      new NextRequest("https://app.test/api/analytics?range=7d"),
    );
    expect(analyticsRes.status).toBe(200);
    const analyticsJson = await analyticsRes.json();
    expect(analyticsJson.report.range).toBe("7d");
    expect(analyticsJson.report.sales.grossRevenueMinor).toBe(120000);

    // Invalid range returns 400
    const badRangeRes = await GET_ANALYTICS(
      new NextRequest("https://app.test/api/analytics?range=invalid"),
    );
    expect(badRangeRes.status).toBe(400);

    // Viewer is denied integrations status and audit logs
    const viewerStatusRes = await GET_INTEGRATION_STATUS(
      new NextRequest("https://app.test/api/integrations/status"),
    );
    expect(viewerStatusRes.status).toBe(403);

    const viewerAuditRes = await GET_AUDIT_LOGS(
      new NextRequest("https://app.test/api/audit-logs"),
    );
    expect(viewerAuditRes.status).toBe(403);

    // Owner gets integration status booleans and org-scoped audit logs
    session = { uid: owner.uid, email: `${owner.uid}@test.com` };
    const ownerStatusRes = await GET_INTEGRATION_STATUS(
      new NextRequest("https://app.test/api/integrations/status"),
    );
    expect(ownerStatusRes.status).toBe(200);
    const statusJson = await ownerStatusRes.json();
    expect(typeof statusJson.status.whatsapp).toBe("boolean");
    expect(typeof statusJson.status.openai).toBe("boolean");
    expect(typeof statusJson.status.cloudinary).toBe("boolean");
    expect(typeof statusJson.status.n8n).toBe("boolean");

    const ownerAuditRes = await GET_AUDIT_LOGS(
      new NextRequest("https://app.test/api/audit-logs?limit=10"),
    );
    expect(ownerAuditRes.status).toBe(200);
    const auditJson = await ownerAuditRes.json();
    expect(auditJson.items).toHaveLength(1);
    expect(auditJson.items[0]).toMatchObject({
      action: "order.confirm",
      resource: "order",
      resourceId: "ord-123",
    });
  });
});
