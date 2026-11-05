import { afterAll, describe, expect, it } from "vitest";

import { adminAuth } from "@/lib/firebase/admin";
import { createEmulatorUser, sleep, type EmulatorUser } from "@/test/auth-emulator";

import { UnauthenticatedError } from "@/lib/errors";

import { createSessionCookie, verifySessionValue } from "./session";

const users: EmulatorUser[] = [];
async function newUser(): Promise<EmulatorUser> {
  const u = await createEmulatorUser();
  users.push(u);
  return u;
}

afterAll(async () => {
  await Promise.all(users.map((u) => adminAuth().deleteUser(u.uid).catch(() => undefined)));
});

describe("createSessionCookie (emulator)", () => {
  it("exchanges a real ID token for a session cookie that verifies", async () => {
    const u = await newUser();
    const { value, maxAgeSec } = await createSessionCookie(u.idToken);
    expect(maxAgeSec).toBeGreaterThanOrEqual(86_400);
    await expect(verifySessionValue(value)).resolves.toEqual({ uid: u.uid, email: u.email });
  });

  it("rejects garbage with UnauthenticatedError", async () => {
    await expect(createSessionCookie("not-a-token")).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(createSessionCookie("a.b.c")).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rejects the ID token of a user whose tokens were revoked", async () => {
    const u = await newUser();
    await sleep(1100); // revocation timestamps have 1s granularity
    await adminAuth().revokeRefreshTokens(u.uid);
    await expect(createSessionCookie(u.idToken)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("verifySessionValue (emulator)", () => {
  it("returns null for undefined, empty and garbage values without throwing", async () => {
    await expect(verifySessionValue(undefined)).resolves.toBeNull();
    await expect(verifySessionValue("")).resolves.toBeNull();
    await expect(verifySessionValue("garbage")).resolves.toBeNull();
    await expect(verifySessionValue("a.b.c")).resolves.toBeNull();
  });

  it("returns null for a tampered cookie", async () => {
    const u = await newUser();
    const { value } = await createSessionCookie(u.idToken);
    const [h, p, s] = value.split(".") as [string, string, string];

    // Payload rewritten to point at another account.
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as Record<string, unknown>;
    payload.sub = "someone-else";
    payload.user_id = "someone-else";
    const forgedPayload = `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`;
    await expect(verifySessionValue(forgedPayload)).resolves.toBeNull();

    // Structurally broken: signature removed, segments dropped or reordered.
    await expect(verifySessionValue(`${h}.${p}`)).resolves.toBeNull();
    await expect(verifySessionValue(`${p}.${h}.${s}`)).resolves.toBeNull();
    await expect(verifySessionValue(`${h}..${s}`)).resolves.toBeNull();

    // NOTE: the Auth emulator does not verify JWT signatures (production does), so a
    // signature-only edit cannot be asserted here.
  });

  it("returns null for the cookie of a user whose refresh tokens were revoked", async () => {
    const u = await newUser();
    const { value } = await createSessionCookie(u.idToken);
    await expect(verifySessionValue(value)).resolves.not.toBeNull();
    await sleep(1100); // revocation timestamps have 1s granularity
    await adminAuth().revokeRefreshTokens(u.uid);
    await expect(verifySessionValue(value)).resolves.toBeNull();
  });

  it("returns null for the cookie of a deleted user", async () => {
    const u = await newUser();
    const { value } = await createSessionCookie(u.idToken);
    await adminAuth().deleteUser(u.uid);
    await expect(verifySessionValue(value)).resolves.toBeNull();
  });
});
