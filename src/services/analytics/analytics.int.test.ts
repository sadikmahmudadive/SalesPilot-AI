import { randomUUID } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";

import { getAnalyticsReport } from "./analytics";

const db = () => adminDb();
const orgs: string[] = [];
const newOrg = () => {
  const id = `org-${randomUUID()}`;
  orgs.push(id);
  return id;
};

afterAll(async () => {
  for (const org of orgs) {
    for (const col of [
      "orders",
      "customers",
      "conversations",
      "voiceCalls",
      "automationRules",
      "automationRuns",
      "products",
      "inventory",
    ]) {
      const snap = await db().collection(col).where("organizationId", "==", org).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  }
});

describe("getAnalyticsReport (integration)", () => {
  it("computes org-isolated analytics from Firestore collections", async () => {
    const org = newOrg();
    const other = newOrg();
    const now = new Date("2026-11-13T08:00:00Z");

    await db()
      .collection("orders")
      .doc(randomUUID())
      .set({
        organizationId: org,
        status: "delivered",
        source: "ai",
        paymentMethod: "cod",
        paymentStatus: "cod_collected",
        totalMinor: 250000,
        lines: [{ productId: "p1", productName: "Jacket", quantity: 1, lineTotalMinor: 240000 }],
        createdAt: Timestamp.fromDate(new Date("2026-11-13T05:00:00Z")),
      });

    await db()
      .collection("orders")
      .doc(randomUUID())
      .set({
        organizationId: other,
        status: "delivered",
        source: "staff",
        paymentMethod: "online",
        paymentStatus: "paid",
        totalMinor: 999999,
        createdAt: Timestamp.fromDate(new Date("2026-11-13T05:00:00Z")),
      });

    await db()
      .collection("customers")
      .doc(randomUUID())
      .set({
        organizationId: org,
        segment: "repeat_customer",
        consent: { status: "granted" },
        createdAt: Timestamp.fromDate(now),
      });

    await db()
      .collection("conversations")
      .doc(randomUUID())
      .set({
        organizationId: org,
        status: "ai_handling",
        channel: "whatsapp",
        unreadCount: 1,
      });

    await db()
      .collection("voiceCalls")
      .doc(randomUUID())
      .set({
        organizationId: org,
        status: "completed",
        outcome: "sale_drafted",
        durationSec: 60,
        createdAt: Timestamp.fromDate(now),
      });

    await db().collection("automationRules").doc(randomUUID()).set({
      organizationId: org,
      enabled: true,
    });

    await db()
      .collection("automationRuns")
      .doc(randomUUID())
      .set({
        organizationId: org,
        status: "succeeded",
        createdAt: Timestamp.fromDate(now),
      });

    await db().collection("products").doc(randomUUID()).set({
      organizationId: org,
      archived: false,
    });

    await db().collection("inventory").doc(randomUUID()).set({
      organizationId: org,
      onHand: 12,
      reserved: 2,
      available: 10,
    });

    const report = await getAnalyticsReport(org, "30d", now);
    expect(report.range).toBe("30d");
    expect(report.sales.totalOrders).toBe(1);
    expect(report.sales.grossRevenueMinor).toBe(250000);
    expect(report.sales.topProducts[0]).toMatchObject({ productId: "p1", quantitySold: 1 });
    expect(report.customers.totalCustomers).toBe(1);
    expect(report.customers.consentBreakdown.granted).toBe(1);
    expect(report.inbox.unreadConversations).toBe(1);
    expect(report.operations.completedVoiceCalls).toBe(1);
    expect(report.operations.activeAutomationRules).toBe(1);
    expect(report.operations.automationRunsSucceeded).toBe(1);
    expect(report.inventory.activeProducts).toBe(1);
    expect(report.inventory.totalAvailable).toBe(10);
  });

  it("rejects invalid organizationId", async () => {
    await expect(getAnalyticsReport("bad/id", "30d")).rejects.toBeInstanceOf(ValidationError);
  });
});
