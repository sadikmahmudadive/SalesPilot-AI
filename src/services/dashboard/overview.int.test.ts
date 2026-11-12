import { randomUUID } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { LOW_STOCK_THRESHOLD } from "@/config/inventory";
import { ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { CUSTOMER_SEGMENTS, type CustomerSegment } from "@/schemas/customer";

import { getOverview } from "./overview";

const db = () => adminDb();
const orgs: string[] = [];
const newOrg = () => {
  const id = `org-${randomUUID()}`;
  orgs.push(id);
  return id;
};

async function seedCustomer(org: string, segment: CustomerSegment) {
  await db()
    .collection("customers")
    .doc(randomUUID())
    .set({ organizationId: org, segment, fullName: "Test" });
}
async function seedProduct(org: string, archived: boolean) {
  await db().collection("products").doc(randomUUID()).set({ organizationId: org, archived });
}
async function seedOrder(
  org: string,
  o: { status: string; paymentStatus: string; totalMinor: number; createdAt: Date },
) {
  await db()
    .collection("orders")
    .doc(randomUUID())
    .set({ organizationId: org, ...o, createdAt: Timestamp.fromDate(o.createdAt) });
}
async function seedInventory(org: string, available: number) {
  await db().collection("inventory").doc(randomUUID()).set({ organizationId: org, available });
}

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  for (const org of orgs) {
    for (const col of ["customers", "products", "inventory", "orders"]) {
      const snap = await db().collection(col).where("organizationId", "==", org).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  }
});

describe("getOverview", () => {
  it("returns zeros for an empty organization", async () => {
    expect(await getOverview(newOrg())).toEqual({
      customers: { ok: true, value: 0 },
      leads: { ok: true, value: 0 },
      products: { ok: true, value: 0 },
      lowStock: { ok: true, value: 0 },
      ordersToday: { ok: true, value: 0 },
      revenueMonthMinor: { ok: true, value: 0 },
    });
  });

  it("counts only the caller's organization", async () => {
    const a = newOrg();
    const b = newOrg();
    // Org A: 2 leads + 1 converted = 3 customers; 2 active + 1 archived product; stock 0, 5 (low), 6 (not).
    await seedCustomer(a, "new_lead");
    await seedCustomer(a, "qualified_lead");
    await seedCustomer(a, "converted");
    await seedProduct(a, false);
    await seedProduct(a, false);
    await seedProduct(a, true);
    await seedInventory(a, 0);
    await seedInventory(a, LOW_STOCK_THRESHOLD);
    await seedInventory(a, LOW_STOCK_THRESHOLD + 1);
    // Org B: different numbers everywhere.
    for (let i = 0; i < 5; i++) await seedCustomer(b, "interested");
    await seedProduct(b, false);
    await seedInventory(b, 1);
    await seedInventory(b, 2);
    await seedInventory(b, 3);
    await seedInventory(b, 4);

    expect(await getOverview(a)).toEqual({
      customers: { ok: true, value: 3 },
      leads: { ok: true, value: 2 },
      products: { ok: true, value: 2 },
      lowStock: { ok: true, value: 2 },
      ordersToday: { ok: true, value: 0 },
      revenueMonthMinor: { ok: true, value: 0 },
    });
    expect(await getOverview(b)).toEqual({
      customers: { ok: true, value: 5 },
      leads: { ok: true, value: 5 },
      products: { ok: true, value: 1 },
      lowStock: { ok: true, value: 4 },
      ordersToday: { ok: true, value: 0 },
      revenueMonthMinor: { ok: true, value: 0 },
    });
  });

  it("counts the threshold boundary: 5 is low, 6 is not", async () => {
    const org = newOrg();
    await seedInventory(org, LOW_STOCK_THRESHOLD);
    expect((await getOverview(org)).lowStock).toEqual({ ok: true, value: 1 });
    await seedInventory(org, LOW_STOCK_THRESHOLD + 1);
    expect((await getOverview(org)).lowStock).toEqual({ ok: true, value: 1 });
  });

  it("counts each lead segment once and ignores non-lead segments", async () => {
    const org = newOrg();
    for (const s of CUSTOMER_SEGMENTS) await seedCustomer(org, s);
    const overview = await getOverview(org);
    expect(overview.customers).toEqual({ ok: true, value: CUSTOMER_SEGMENTS.length });
    expect(overview.leads).toEqual({ ok: true, value: 4 });
  });

  it("does not count archived products", async () => {
    const org = newOrg();
    await seedProduct(org, true);
    await seedProduct(org, true);
    expect((await getOverview(org)).products).toEqual({ ok: true, value: 0 });
    await seedProduct(org, false);
    expect((await getOverview(org)).products).toEqual({ ok: true, value: 1 });
  });

  it("reports a failing metric as not ok without affecting the others, and logs its name", async () => {
    const org = newOrg();
    await seedCustomer(org, "new_lead");
    await seedProduct(org, false);
    await seedInventory(org, 1);
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    const overview = await getOverview(org, {
      runCount: async (metric, query) => {
        if (metric === "leads") throw new Error("boom: secret detail");
        return (await query.count().get()).data().count;
      },
    });

    expect(overview.leads).toEqual({ ok: false });
    expect(overview.customers).toEqual({ ok: true, value: 1 });
    expect(overview.products).toEqual({ ok: true, value: 1 });
    expect(overview.lowStock).toEqual({ ok: true, value: 1 });
    expect(error).toHaveBeenCalledTimes(1);
    const [, ctx] = error.mock.calls[0]!;
    expect(ctx).toMatchObject({ metric: "leads" });
    expect(JSON.stringify(ctx)).not.toContain("secret detail");
  });

  describe("order metrics", () => {
    const NOW = new Date("2026-11-12T06:00:00Z"); // 12:00 on 12 Nov in Dhaka
    const todayAt = new Date("2026-11-11T18:00:00Z"); // Dhaka midnight, inclusive
    const yesterday = new Date("2026-11-11T17:59:59Z");
    const monthStart = new Date("2026-10-31T18:00:00Z");
    const lastMonth = new Date("2026-10-31T17:59:59Z");

    it("ordersToday counts today's orders except draft and cancelled", async () => {
      const org = newOrg();
      const other = newOrg();
      const base = { paymentStatus: "cod_pending", totalMinor: 100 };
      for (const status of ["confirmed", "processing", "shipped", "delivered", "returned"]) {
        await seedOrder(org, { ...base, status, createdAt: todayAt });
      }
      await seedOrder(org, { ...base, status: "draft", createdAt: todayAt });
      await seedOrder(org, { ...base, status: "cancelled", createdAt: todayAt });
      await seedOrder(org, { ...base, status: "confirmed", createdAt: yesterday });
      await seedOrder(other, { ...base, status: "confirmed", createdAt: todayAt });
      expect((await getOverview(org, { now: () => NOW })).ordersToday).toEqual({
        ok: true,
        value: 5,
      });
      expect((await getOverview(other, { now: () => NOW })).ordersToday).toEqual({
        ok: true,
        value: 1,
      });
    });

    it("revenueMonthMinor sums paid and COD collected this Dhaka month only", async () => {
      const org = newOrg();
      const other = newOrg();
      const mk = (paymentStatus: string, totalMinor: number, createdAt = monthStart) =>
        seedOrder(org, { status: "delivered", paymentStatus, totalMinor, createdAt });
      await mk("paid", 10_000);
      await mk("cod_collected", 2_550);
      await mk("cod_collected", 450, new Date("2026-11-12T05:00:00Z"));
      await mk("cod_pending", 99_999); // unpaid COD
      await mk("awaiting_payment", 88_888);
      await mk("failed", 77_777);
      await mk("refunded", 66_666);
      await mk("paid", 55_555, lastMonth); // before the month
      await seedOrder(other, {
        status: "delivered",
        paymentStatus: "paid",
        totalMinor: 1,
        createdAt: monthStart,
      });
      expect((await getOverview(org, { now: () => NOW })).revenueMonthMinor).toEqual({
        ok: true,
        value: 13_000,
      });
      expect((await getOverview(other, { now: () => NOW })).revenueMonthMinor).toEqual({
        ok: true,
        value: 1,
      });
    });

    it("a failing order metric is { ok: false } and the others keep their numbers", async () => {
      const org = newOrg();
      await seedCustomer(org, "new_lead");
      await seedOrder(org, {
        status: "confirmed",
        paymentStatus: "paid",
        totalMinor: 500,
        createdAt: todayAt,
      });
      const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
      const overview = await getOverview(org, {
        now: () => NOW,
        runCount: async (metric, query) => {
          if (metric === "ordersToday") throw new Error("boom: secret detail");
          return (await query.count().get()).data().count;
        },
      });
      expect(overview.ordersToday).toEqual({ ok: false });
      expect(overview.revenueMonthMinor).toEqual({ ok: true, value: 500 });
      expect(overview.customers).toEqual({ ok: true, value: 1 });
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0]![1]).toMatchObject({ metric: "ordersToday" });
      expect(JSON.stringify(error.mock.calls[0]![1])).not.toContain("secret detail");

      const failing = await getOverview(org, {
        now: () => NOW,
        runSum: async () => {
          throw new Error("boom");
        },
      });
      expect(failing.revenueMonthMinor).toEqual({ ok: false });
      expect(failing.ordersToday).toEqual({ ok: true, value: 1 });
    });
  });

  it("rejects an invalid organization id", async () => {
    for (const bad of ["", "a/b", ".", "..", "__x__"]) {
      await expect(getOverview(bad), bad).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(getOverview(undefined as unknown as string)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
