import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { formatOrderNumber, nextOrderNumber, settingsRef } from "@/repositories/orders";
import { DEFAULT_ORDER_SETTINGS } from "@/schemas/order";

import { getOrderSettings, updateOrderSettings } from "./settings";

const orgs: string[] = [];
function newCtx() {
  const organizationId = `org-${randomUUID()}`;
  orgs.push(organizationId);
  return { organizationId, uid: `uid-${randomUUID()}` };
}
const db = () => adminDb();
const audits = async (organizationId: string) =>
  (await db().collection("auditLogs").where("organizationId", "==", organizationId).get()).docs;
const next = (organizationId: string) =>
  db().runTransaction((tx) => nextOrderNumber(tx, organizationId));

afterAll(async () => {
  for (const org of orgs) {
    for (const col of ["auditLogs", "orderSettings", "orderCounters"]) {
      const snap = await db().collection(col).where("organizationId", "==", org).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  }
});

describe("order settings", () => {
  it("returns the defaults when the doc is absent", async () => {
    const ctx = newCtx();
    expect(await getOrderSettings(ctx.organizationId)).toEqual(DEFAULT_ORDER_SETTINGS);
  });

  it("update then get round-trips, merging a partial patch over the defaults", async () => {
    const ctx = newCtx();
    const updated = await updateOrderSettings(ctx, { deliveryChargeInsideDhakaMinor: 5000 });
    expect(updated).toEqual({ ...DEFAULT_ORDER_SETTINGS, deliveryChargeInsideDhakaMinor: 5000 });
    expect(await getOrderSettings(ctx.organizationId)).toEqual(updated);

    const again = await updateOrderSettings(ctx, { paymentHoldHours: 48 });
    expect(again).toEqual({ ...updated, paymentHoldHours: 48 });
    expect(await getOrderSettings(ctx.organizationId)).toEqual(again);
  });

  it("writes exactly one audit row per update, with action orderSettings.update", async () => {
    const ctx = newCtx();
    await updateOrderSettings(ctx, { draftHoldMinutes: 45 });
    const rows = await audits(ctx.organizationId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!.data();
    expect(row.action).toBe("orderSettings.update");
    expect(row.resource).toBe("orderSettings");
    expect(row.resourceId).toBe(ctx.organizationId);
    expect(row.actorUid).toBe(ctx.uid);
    expect(row.before).toEqual(DEFAULT_ORDER_SETTINGS);
    expect(row.after).toEqual({ ...DEFAULT_ORDER_SETTINGS, draftHoldMinutes: 45 });
  });

  it("does not touch another org's settings", async () => {
    const a = newCtx();
    const b = newCtx();
    await updateOrderSettings(a, { deliveryChargeOutsideDhakaMinor: 20000 });
    expect(await getOrderSettings(b.organizationId)).toEqual(DEFAULT_ORDER_SETTINGS);
    expect((await settingsRef(b.organizationId).get()).exists).toBe(false);
    expect(await audits(b.organizationId)).toHaveLength(0);
  });

  it("rejects an invalid patch and writes nothing", async () => {
    const ctx = newCtx();
    await expect(updateOrderSettings(ctx, { draftHoldMinutes: 1 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      updateOrderSettings(ctx, { deliveryChargeInsideDhakaMinor: -5 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await settingsRef(ctx.organizationId).get()).exists).toBe(false);
    expect(await audits(ctx.organizationId)).toHaveLength(0);
  });

  it("an AI actor update still audits under the ctx uid", async () => {
    const ctx = { ...newCtx(), actor: { kind: "ai" as const, agentId: "ag1", sessionId: "s1" } };
    await updateOrderSettings(ctx, { paymentHoldHours: 2 });
    const [row] = await audits(ctx.organizationId);
    expect(row!.data().actorUid).toBe(ctx.uid);
    expect(row!.data().after).toMatchObject({ paymentHoldHours: 2 });
  });

  it("a malformed stored doc yields defaults merged with the fields that individually pass", async () => {
    const ctx = newCtx();
    await settingsRef(ctx.organizationId).set({
      organizationId: ctx.organizationId,
      deliveryChargeInsideDhakaMinor: 7000, // valid
      deliveryChargeOutsideDhakaMinor: "lots", // invalid
      draftHoldMinutes: 1, // out of range
      paymentHoldHours: 12.5, // not an integer
    });
    expect(await getOrderSettings(ctx.organizationId)).toEqual({
      ...DEFAULT_ORDER_SETTINGS,
      deliveryChargeInsideDhakaMinor: 7000,
    });
  });

  it("a doc belonging to another org is treated as absent", async () => {
    const ctx = newCtx();
    await settingsRef(ctx.organizationId).set({
      organizationId: "someone-else",
      deliveryChargeInsideDhakaMinor: 1,
    });
    expect(await getOrderSettings(ctx.organizationId)).toEqual(DEFAULT_ORDER_SETTINGS);
  });
});

describe("nextOrderNumber", () => {
  it("starts at SP-000001 and increments across transactions", async () => {
    const ctx = newCtx();
    expect([await next(ctx.organizationId), await next(ctx.organizationId)]).toEqual([
      "SP-000001",
      "SP-000002",
    ]);
  });

  it("20 concurrent transactions on one org yield 20 distinct consecutive numbers", async () => {
    const ctx = newCtx();
    const numbers = await Promise.all(Array.from({ length: 20 }, () => next(ctx.organizationId)));
    expect(new Set(numbers).size).toBe(20);
    expect([...numbers].sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => formatOrderNumber(i + 1)),
    );
  });

  it("counters of different orgs are independent", async () => {
    const a = newCtx();
    const b = newCtx();
    await next(a.organizationId);
    await next(a.organizationId);
    expect(await next(b.organizationId)).toBe("SP-000001");
  });
});
