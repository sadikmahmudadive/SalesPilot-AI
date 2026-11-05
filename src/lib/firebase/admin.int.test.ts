import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";

import { adminAuth, adminDb } from "./admin";

const runId = randomUUID();
const docIds = [`a-${runId}`, `b-${runId}`, `c-${runId}`];

afterAll(async () => {
  await Promise.all(docIds.map((id) => adminDb().collection("smoke").doc(id).delete()));
});

describe("firebase admin (emulator)", () => {
  it("writes and reads a Firestore document", async () => {
    const ref = adminDb().collection("smoke").doc(docIds[0]!);
    await ref.set({ x: 1 });
    const snap = await ref.get();
    expect(snap.data()).toEqual({ x: 1 });
  });

  it("ignores undefined properties on write", async () => {
    const ref = adminDb().collection("smoke").doc(docIds[1]!);
    await ref.set({ x: 1, y: undefined });
    expect((await ref.get()).data()).toEqual({ x: 1 });
  });

  it("survives the module being re-evaluated (HMR / separate bundles)", async () => {
    const first = adminDb();
    vi.resetModules();
    const again = await import("./admin");
    expect(() => again.adminDb()).not.toThrow();
    expect(again.adminDb()).toBe(first);
    const ref = again.adminDb().collection("smoke").doc(docIds[2]!);
    await ref.set({ x: 1, y: undefined });
    expect((await ref.get()).data()).toEqual({ x: 1 });
  });

  it("creates an Auth user", async () => {
    const user = await adminAuth().createUser({ email: `smoke-${randomUUID()}@example.com` });
    try {
      expect(user.uid).toEqual(expect.any(String));
    } finally {
      await adminAuth().deleteUser(user.uid);
    }
  });
});
