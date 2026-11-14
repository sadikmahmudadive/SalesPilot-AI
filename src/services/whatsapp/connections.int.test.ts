import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { __resetEnvCacheForTests } from "@/config/env";
import { ConflictError, IntegrationNotConfiguredError, ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { unsealSecret } from "@/lib/security/secret-box";
import type { WhatsAppConnectionInput } from "@/schemas/whatsapp-connection";
import { fakeMeta } from "@/test/whatsapp-meta";

import {
  META_REJECTED_MESSAGE,
  NUMBER_TAKEN_MESSAGE,
  disconnectWhatsApp,
  getWhatsAppConnection,
  resolveWhatsAppOrg,
  saveWhatsAppConnection,
  testWhatsAppConnection,
  whatsappClientFor,
} from "./connections";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");
vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);

const TOKEN = "EAAG-test-token-0123456789";
const db = () => adminDb();
const orgs: string[] = [];
const newCtx = () => {
  const organizationId = `org-${randomUUID()}`;
  orgs.push(organizationId);
  return { organizationId, uid: "uid-owner" };
};
let numberCounter = 100000;
const newNumber = () => String(++numberCounter) + String(Date.now()).slice(-6);

const lockOf = async (phoneNumberId: string) =>
  (await db().collection("whatsappPhoneNumbers").doc(phoneNumberId).get()).data();
const storedOf = async (orgId: string) =>
  (await db().collection("whatsappConnections").doc(orgId).get()).data();

/** Saves `number` for `ctx` with Meta accepting TOKEN for it. */
function save(
  ctx: { organizationId: string; uid: string },
  number: string,
  over: Partial<WhatsAppConnectionInput> = {},
  meta = fakeMeta({ [number]: TOKEN }),
) {
  return saveWhatsAppConnection(
    ctx,
    { phoneNumberId: number, businessAccountId: "1022901", accessToken: TOKEN, enabled: true, ...over },
    { fetchFn: meta },
  );
}

afterEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
  for (const k of ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ORGANIZATION_ID", "WHATSAPP_ACCESS_TOKEN"]) {
    vi.stubEnv(k, "");
  }
  __resetEnvCacheForTests();
});

/** Env single-number fallback: `number` belongs to `orgId` with `token`. */
function stubEnvNumber(number: string, orgId: string, token = "ENV-token-0123456789-abcdef") {
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", number);
  vi.stubEnv("WHATSAPP_ORGANIZATION_ID", orgId);
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", token);
  __resetEnvCacheForTests();
}

async function seedOrg(orgId: string) {
  await db().collection("organizations").doc(orgId).set({ name: "Shop", ownerUid: "u1" });
}

afterAll(async () => {
  for (const orgId of orgs) {
    await db().collection("organizations").doc(orgId).delete();
    await db().collection("whatsappConnections").doc(orgId).delete();
    const locks = await db().collection("whatsappPhoneNumbers").where("organizationId", "==", orgId).get();
    await Promise.all(locks.docs.map((d) => d.ref.delete()));
  }
  vi.unstubAllEnvs();
});

describe("WhatsApp connection service", () => {
  it("saves a number Meta confirms, without returning the token", async () => {
    const ctx = newCtx();
    const number = newNumber();
    const summary = await save(ctx, number);
    expect(summary).toMatchObject({
      connected: true,
      phoneNumberId: number,
      hasAccessToken: true,
      lastTestResult: "ok",
      displayPhoneNumber: "+880 1711-000000",
      verifiedName: "Brand Booster",
    });
    expect(JSON.stringify(summary)).not.toContain(TOKEN);
    expect(JSON.stringify(await getWhatsAppConnection(ctx))).not.toContain(TOKEN);

    const stored = (await storedOf(ctx.organizationId))!;
    expect(JSON.parse(unsealSecret(stored.credentials))).toEqual({ accessToken: TOKEN });
    expect(await lockOf(number)).toEqual({ organizationId: ctx.organizationId });
    const audits = await db()
      .collection("auditLogs")
      .where("organizationId", "==", ctx.organizationId)
      .where("action", "==", "whatsapp.connection.save")
      .get();
    expect(audits.size).toBe(1);
    expect(JSON.stringify(audits.docs[0]!.data())).not.toContain(TOKEN);
  });

  it("a fake token cannot claim a number", async () => {
    const ctx = newCtx();
    const number = newNumber();
    const err = await save(ctx, number, { accessToken: "made-up-token-0123456789" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toBe(META_REJECTED_MESSAGE);
    expect(await lockOf(number)).toBeUndefined();
    expect((await getWhatsAppConnection(ctx)).connected).toBe(false);
  });

  it("the number must belong to the business account the token can see", async () => {
    const ctx = newCtx();
    const number = newNumber();
    const other = newNumber();
    // The token is valid for `other`, not for `number`.
    const err = await save(ctx, number, {}, fakeMeta({ [other]: TOKEN })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(await lockOf(number)).toBeUndefined();
  });

  it("another workspace cannot claim the env number", async () => {
    const envOwner = newCtx();
    const other = newCtx();
    await seedOrg(envOwner.organizationId);
    const number = newNumber();
    stubEnvNumber(number, envOwner.organizationId);
    const err = await save(other, number).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).message).toBe(NUMBER_TAKEN_MESSAGE);
    expect(await resolveWhatsAppOrg(number)).toBe(envOwner.organizationId);
    // The env owner itself may connect it.
    await expect(save(envOwner, number)).resolves.toMatchObject({ connected: true });
  });

  it("another workspace's number is a 409", async () => {
    const a = newCtx();
    const b = newCtx();
    const number = newNumber();
    await save(a, number);
    const err = await save(b, number).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).message).toBe(NUMBER_TAKEN_MESSAGE);
    expect((await getWhatsAppConnection(b)).connected).toBe(false);
  });

  it("changing the number moves the lock", async () => {
    const a = newCtx();
    const b = newCtx();
    const first = newNumber();
    const second = newNumber();
    const meta = fakeMeta({ [first]: TOKEN, [second]: TOKEN });
    await save(a, first, {}, meta);
    await save(a, second, { accessToken: undefined }, meta);
    expect(await lockOf(first)).toBeUndefined();
    expect(await lockOf(second)).toEqual({ organizationId: a.organizationId });
    await expect(save(b, first, {}, meta)).resolves.toMatchObject({ connected: true, phoneNumberId: first });
  });

  it("update without accessToken keeps the token", async () => {
    const ctx = newCtx();
    const number = newNumber();
    await save(ctx, number);
    const updated = await save(ctx, number, { accessToken: undefined, enabled: false });
    expect(updated).toMatchObject({ enabled: false, hasAccessToken: true, lastTestResult: "ok" });
    const stored = (await storedOf(ctx.organizationId))!;
    expect(JSON.parse(unsealSecret(stored.credentials))).toEqual({ accessToken: TOKEN });
  });

  it("first save without a token is a validation error", async () => {
    const ctx = newCtx();
    const err = await save(ctx, newNumber(), { accessToken: undefined }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details?.[0]?.path).toBe("accessToken");
  });

  it("disconnect removes connection and lock", async () => {
    const ctx = newCtx();
    const number = newNumber();
    await save(ctx, number);
    await disconnectWhatsApp(ctx);
    expect((await getWhatsAppConnection(ctx)).connected).toBe(false);
    expect(await lockOf(number)).toBeUndefined();
  });

  it("test records ok with the display number", async () => {
    const ctx = newCtx();
    const number = newNumber();
    await save(ctx, number);
    const summary = await testWhatsAppConnection(ctx, {
      fetchFn: fakeMeta({ [number]: TOKEN }, { displayPhoneNumber: "+880 1811-000000", verifiedName: "New Name" }),
    });
    expect(summary).toMatchObject({
      lastTestResult: "ok",
      displayPhoneNumber: "+880 1811-000000",
      verifiedName: "New Name",
    });
  });

  it("test records failed on a Graph error", async () => {
    const ctx = newCtx();
    const number = newNumber();
    await save(ctx, number);
    const failed = await testWhatsAppConnection(ctx, { fetchFn: fakeMeta({}) });
    expect(failed.lastTestResult).toBe("failed");
    expect(JSON.stringify(failed)).not.toContain("Invalid OAuth");

    const throwing = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(testWhatsAppConnection(ctx, { fetchFn: throwing })).resolves.toMatchObject({
      lastTestResult: "failed",
    });
  });

  it("a test result is not written onto a connection that changed during the call", async () => {
    const ctx = newCtx();
    const first = newNumber();
    const second = newNumber();
    const meta = fakeMeta({ [first]: TOKEN, [second]: TOKEN });
    await save(ctx, first, {}, meta);
    const slow = (async (input: string | URL | Request, init?: RequestInit) => {
      // The owner switches to another number while the test call is in flight.
      await save(ctx, second, { accessToken: undefined }, meta);
      return fakeMeta({ [first]: TOKEN }, { verifiedName: "Old Number" })(input, init);
    }) as typeof fetch;
    const summary = await testWhatsAppConnection(ctx, { fetchFn: slow });
    expect(summary.phoneNumberId).toBe(second);
    expect((await storedOf(ctx.organizationId))!.verifiedName).not.toBe("Old Number");
  });

  it("a test during a disconnect does not fail", async () => {
    const ctx = newCtx();
    const number = newNumber();
    await save(ctx, number);
    const disconnecting = (async (input: string | URL | Request, init?: RequestInit) => {
      await disconnectWhatsApp(ctx);
      return fakeMeta({ [number]: TOKEN })(input, init);
    }) as typeof fetch;
    await expect(testWhatsAppConnection(ctx, { fetchFn: disconnecting })).resolves.toMatchObject({
      connected: false,
    });
    expect(await storedOf(ctx.organizationId)).toBeUndefined();
  });

  it("refuses without ENCRYPTION_KEY", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    const ctx = newCtx();
    await expect(save(ctx, newNumber())).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });
});

describe("WhatsApp routing and sending", () => {
  it("routes a number to the workspace that connected it", async () => {
    const ctx = newCtx();
    const number = newNumber();
    await save(ctx, number);
    expect(await resolveWhatsAppOrg(number)).toBe(ctx.organizationId);
    expect(await resolveWhatsAppOrg(newNumber())).toBeNull();
    expect(await resolveWhatsAppOrg(undefined)).toBeNull();
  });

  it("the env owner's own connection of the env number beats env", async () => {
    const a = newCtx();
    await seedOrg(a.organizationId);
    const number = newNumber();
    stubEnvNumber(number, a.organizationId);
    await save(a, number, { enabled: false });
    // Its connection is disabled: dropped, not handed to the env fallback.
    expect(await resolveWhatsAppOrg(number)).toBeNull();
  });

  it("disabled connection drops and does not send", async () => {
    const b = newCtx();
    const number = newNumber();
    await save(b, number, { enabled: false });
    expect(await resolveWhatsAppOrg(number)).toBeNull();
    expect(await whatsappClientFor(b.organizationId)).toBeNull();
  });

  it("env fallback still works", async () => {
    const a = newCtx();
    await seedOrg(a.organizationId);
    const number = newNumber();
    stubEnvNumber(number, a.organizationId);
    expect(await resolveWhatsAppOrg(number)).toBe(a.organizationId);
    expect(await whatsappClientFor(a.organizationId)).not.toBeNull();
    expect(await whatsappClientFor(newCtx().organizationId)).toBeNull();
  });

  it("whatsappClientFor uses the connection token", async () => {
    const ctx = newCtx();
    const number = newNumber();
    await save(ctx, number);
    const meta = fakeMeta({ [number]: TOKEN });
    const client = await whatsappClientFor(ctx.organizationId, { fetchFn: meta });
    await expect(client!.sendTextMessage("+8801711000000", "Hello")).resolves.toEqual({ messageId: "wamid.fake.1" });
    expect(meta.sends[0]).toMatchObject({ phoneNumberId: number, authorization: `Bearer ${TOKEN}` });
  });

  it("a client for a specific number only exists while that number is this workspace's", async () => {
    const a = newCtx();
    await seedOrg(a.organizationId);
    const envNumber = newNumber();
    const ownNumber = newNumber();
    stubEnvNumber(envNumber, a.organizationId, "ENV-token-0123456789-abcdef");
    await save(a, ownNumber);
    const meta = fakeMeta({ [envNumber]: "ENV-token-0123456789-abcdef", [ownNumber]: TOKEN });
    // Replies to a message that arrived on the env number go out from the env number.
    const envClient = await whatsappClientFor(a.organizationId, { fetchFn: meta, phoneNumberId: envNumber });
    await envClient!.sendTextMessage("+8801711000000", "Hi");
    expect(meta.sends[0]!.phoneNumberId).toBe(envNumber);
    // A number this workspace does not have gives no client.
    expect(await whatsappClientFor(a.organizationId, { phoneNumberId: newNumber() })).toBeNull();
  });
});
