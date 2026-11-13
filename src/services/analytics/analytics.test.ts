import { describe, expect, it } from "vitest";

import {
  aggregateCustomers,
  aggregateInbox,
  aggregateInventory,
  aggregateOperations,
  aggregateOrders,
  dhakaDateString,
  rangeCutoffDate,
} from "./analytics";

const NOW = new Date("2026-11-13T08:00:00Z"); // 14:00 on 2026-11-13 in Dhaka (+06:00)

describe("dhakaDateString & rangeCutoffDate", () => {
  it("converts UTC boundary timestamps to Dhaka calendar dates", () => {
    expect(dhakaDateString(new Date("2026-11-12T18:00:00Z"))).toBe("2026-11-13");
    expect(dhakaDateString(new Date("2026-11-12T17:59:59Z"))).toBe("2026-11-12");
  });

  it("computes cutoff dates for ranges and returns null for all", () => {
    expect(rangeCutoffDate("all", NOW)).toBeNull();
    // 7d inclusive starts 6 days before 2026-11-13 Dhaka midnight (2026-11-06T18:00:00Z)
    expect(rangeCutoffDate("7d", NOW)?.toISOString()).toBe("2026-11-06T18:00:00.000Z");
  });
});

describe("aggregateOrders", () => {
  it("computes revenue, pending revenue, sources, daily series and top products", () => {
    const summary = aggregateOrders(
      [
        {
          status: "delivered",
          source: "ai",
          paymentMethod: "cod",
          paymentStatus: "cod_collected",
          totalMinor: 150000,
          createdAt: "2026-11-13T06:00:00Z",
          lines: [
            { productId: "p1", productName: "Polo Shirt", quantity: 2, lineTotalMinor: 140000 },
          ],
        },
        {
          status: "confirmed",
          source: "staff",
          paymentMethod: "online",
          paymentStatus: "awaiting_payment",
          totalMinor: 80000,
          createdAt: "2026-11-12T10:00:00Z",
          lines: [
            { productId: "p2", productName: "Cap", quantity: 1, lineTotalMinor: 70000 },
            { productId: "p1", productName: "Polo Shirt", quantity: 1, lineTotalMinor: 10000 },
          ],
        },
        {
          status: "draft",
          source: "ai",
          paymentMethod: "cod",
          paymentStatus: "cod_pending",
          totalMinor: 999999,
          createdAt: "2026-11-13T05:00:00Z",
        },
        {
          status: "cancelled",
          source: "staff",
          paymentMethod: "cod",
          paymentStatus: "cod_pending",
          totalMinor: 50000,
          createdAt: "2026-11-13T05:00:00Z",
        },
        {
          status: "delivered",
          source: "ai",
          paymentMethod: "online",
          paymentStatus: "paid",
          totalMinor: 40000,
          createdAt: "2026-10-01T00:00:00Z", // outside 7d
        },
      ],
      "7d",
      NOW,
    );

    expect(summary.totalOrders).toBe(2);
    expect(summary.draftOrders).toBe(1);
    expect(summary.cancelledOrders).toBe(1);
    expect(summary.deliveredOrders).toBe(1);
    expect(summary.grossRevenueMinor).toBe(150000);
    expect(summary.pendingRevenueMinor).toBe(80000);
    expect(summary.averageOrderValueMinor).toBe(115000);
    expect(summary.codOrders).toBe(1);
    expect(summary.onlineOrders).toBe(1);
    expect(summary.bySource).toEqual({ ai: 1, staff: 1 });
    expect(summary.dailySeries).toHaveLength(7);
    expect(summary.dailySeries.at(-1)).toEqual({
      date: "2026-11-13",
      orders: 1,
      revenueMinor: 150000,
    });
    expect(summary.topProducts).toEqual([
      { productId: "p1", productName: "Polo Shirt", quantitySold: 3, revenueMinor: 150000 },
      { productId: "p2", productName: "Cap", quantitySold: 1, revenueMinor: 70000 },
    ]);
  });
});

describe("aggregateCustomers, aggregateInbox, aggregateOperations, aggregateInventory", () => {
  it("aggregates customer segments, consent, inbox, voice, automations and inventory", () => {
    const cust = aggregateCustomers(
      [
        { segment: "new_lead", consent: { status: "granted" }, createdAt: "2026-11-13T01:00:00Z" },
        { segment: "converted", consent: { status: "denied" }, createdAt: "2026-10-01T01:00:00Z" },
      ],
      "7d",
      NOW,
    );
    expect(cust.totalCustomers).toBe(2);
    expect(cust.newCustomersInRange).toBe(1);
    expect(cust.consentBreakdown).toEqual({ granted: 1, denied: 1, unknown: 0 });
    expect(cust.bySegment.new_lead).toBe(1);

    const inbox = aggregateInbox([
      { status: "needs_reply", channel: "whatsapp", unreadCount: 2 },
      { status: "resolved", channel: "whatsapp", unreadCount: 0 },
    ]);
    expect(inbox.totalConversations).toBe(2);
    expect(inbox.unreadConversations).toBe(1);
    expect(inbox.byStatus.needs_reply).toBe(1);
    expect(inbox.byChannel.whatsapp).toBe(2);

    const ops = aggregateOperations(
      [
        {
          status: "completed",
          outcome: "order_confirmed",
          durationSec: 45,
          createdAt: "2026-11-13T02:00:00Z",
        },
        {
          status: "failed",
          outcome: "no_answer",
          durationSec: 0,
          createdAt: "2026-09-01T00:00:00Z", // outside 7d
        },
      ],
      [{ enabled: true }, { enabled: false }],
      [
        { status: "succeeded", createdAt: "2026-11-13T03:00:00Z" },
        { status: "skipped", createdAt: "2026-11-13T03:00:00Z" },
      ],
      "7d",
      NOW,
    );
    expect(ops).toEqual({
      totalVoiceCalls: 1,
      completedVoiceCalls: 1,
      totalTalkDurationSec: 45,
      voiceOutcomes: { order_confirmed: 1 },
      activeAutomationRules: 1,
      automationRunsSucceeded: 1,
      automationRunsSkipped: 1,
      automationRunsFailed: 0,
    });

    const inv = aggregateInventory(
      [{ archived: false }, { archived: true }],
      [
        { onHand: 10, reserved: 2, available: 8 },
        { onHand: 3, reserved: 0, available: 3 }, // low stock (<= 5)
        { onHand: 1, reserved: 1, available: 0 }, // out of stock
      ],
    );
    expect(inv).toEqual({
      activeProducts: 1,
      totalSkus: 3,
      totalOnHand: 14,
      totalReserved: 3,
      totalAvailable: 11,
      lowStockCount: 1,
      outOfStockCount: 1,
    });
  });
});
