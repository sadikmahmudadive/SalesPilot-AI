import { describe, expect, it } from "vitest";

import { adminAuth, adminDb } from "./admin";

describe("firebase admin (emulator)", () => {
  it("writes and reads a Firestore document", async () => {
    const ref = adminDb().collection("smoke").doc("a");
    await ref.set({ x: 1 });
    const snap = await ref.get();
    expect(snap.data()).toEqual({ x: 1 });
  });

  it("ignores undefined properties on write", async () => {
    const ref = adminDb().collection("smoke").doc("b");
    await ref.set({ x: 1, y: undefined });
    expect((await ref.get()).data()).toEqual({ x: 1 });
  });

  it("creates an Auth user", async () => {
    const user = await adminAuth().createUser({ email: `smoke-${Date.now()}@example.com` });
    expect(user.uid).toEqual(expect.any(String));
    await adminAuth().deleteUser(user.uid);
  });
});
