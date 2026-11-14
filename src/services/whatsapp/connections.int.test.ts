import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { ConflictError, IntegrationNotConfiguredError, ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { unsealSecret } from "@/lib/security/secret-box";

import {
  NUMBER_TAKEN_MESSAGE,
  disconnectWhatsApp,
  getWhatsAppConnection,
  saveWhatsAppConnection,
  testWhatsAppConnection,
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

afterEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
});

afterAll(async () => {
  for (const orgId of orgs) {
    await db().collection("whatsappConnections").doc(orgId).delete();
    const locks = await db().collection("whatsappPhoneNumbers").where("organizationId", "==", orgId).get();
    await Promise.all(locks.docs.map((d) => d.ref.delete()));
  }
  vi.unstubAllEnvs();
});

describe("WhatsApp connection service", () => {
  it("saves and reads back without the token", async () => {
    const ctx = newCtx();
    const number = newNumber();
    const summary = await saveWhatsAppConnection(ctx, {
      phoneNumberId: number,
      businessAccountId: "102290129340398",
      accessToken: TOKEN,
      enabled: true,
    });
    expect(summary).toMatchObject({ connected: true, phoneNumberId: number, hasAccessToken: true });
    expect(JSON.stringify(summary)).not.toContain(TOKEN);
    expect(JSON.stringify(await getWhatsAppConnection(ctx))).not.toContain(TOKEN);

    const stored = (await db().collection("whatsappConnections").doc(ctx.organizationId).get()).data()!;
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

  it("another workspace's number is a 409", async () => {
    const a = newCtx();
    const b = newCtx();
    const number = newNumber();
    await saveWhatsAppConnection(a, { phoneNumberId: number, businessAccountId: "1022901", accessToken: TOKEN, enabled: true });
    const err = await saveWhatsAppConnection(b, {
      phoneNumberId: number,
      businessAccountId: "1022902",
      accessToken: TOKEN,
      enabled: true,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).message).toBe(NUMBER_TAKEN_MESSAGE);
    expect((await getWhatsAppConnection(b)).connected).toBe(false);
  });

  it("changing the number moves the lock", async () => {
    const a = newCtx();
    const b = newCtx();
    const first = newNumber();
    const second = newNumber();
    await saveWhatsAppConnection(a, { phoneNumberId: first, businessAccountId: "1022901", accessToken: TOKEN, enabled: true });
    await saveWhatsAppConnection(a, { phoneNumberId: second, businessAccountId: "1022901", enabled: true });
    expect(await lockOf(first)).toBeUndefined();
    expect(await lockOf(second)).toEqual({ organizationId: a.organizationId });
    await expect(
      saveWhatsAppConnection(b, { phoneNumberId: first, businessAccountId: "1022902", accessToken: TOKEN, enabled: true }),
    ).resolves.toMatchObject({ connected: true, phoneNumberId: first });
  });

  it("update without accessToken keeps the token", async () => {
    const ctx = newCtx();
    const number = newNumber();
    await saveWhatsAppConnection(ctx, { phoneNumberId: number, businessAccountId: "1022901", accessToken: TOKEN, enabled: true });
    const updated = await saveWhatsAppConnection(ctx, {
      phoneNumberId: number,
      businessAccountId: "1022999",
      enabled: false,
    });
    expect(updated).toMatchObject({ businessAccountId: "1022999", enabled: false, hasAccessToken: true });
    const stored = (await db().collection("whatsappConnections").doc(ctx.organizationId).get()).data()!;
    expect(JSON.parse(unsealSecret(stored.credentials))).toEqual({ accessToken: TOKEN });
  });

  it("first save without a token is a validation error", async () => {
    const ctx = newCtx();
    const err = await saveWhatsAppConnection(ctx, {
      phoneNumberId: newNumber(),
      businessAccountId: "1022901",
      enabled: true,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details?.[0]?.path).toBe("accessToken");
  });

  it("disconnect removes connection and lock", async () => {
    const ctx = newCtx();
    const number = newNumber();
    await saveWhatsAppConnection(ctx, { phoneNumberId: number, businessAccountId: "1022901", accessToken: TOKEN, enabled: true });
    await disconnectWhatsApp(ctx);
    expect((await getWhatsAppConnection(ctx)).connected).toBe(false);
    expect(await lockOf(number)).toBeUndefined();
  });

  it("test records ok with the display number", async () => {
    const ctx = newCtx();
    const number = newNumber();
    await saveWhatsAppConnection(ctx, { phoneNumberId: number, businessAccountId: "1022901", accessToken: TOKEN, enabled: true });
    let seen: { url: string; auth: string | null } | null = null;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      seen = { url, auth: new Headers(init?.headers).get("authorization") };
      return Response.json({ display_phone_number: "+880 1711-000000", verified_name: "Brand Booster", id: number });
    }) as unknown as typeof fetch;
    const summary = await testWhatsAppConnection(ctx, { fetchFn });
    expect(summary).toMatchObject({
      lastTestResult: "ok",
      displayPhoneNumber: "+880 1711-000000",
      verifiedName: "Brand Booster",
    });
    expect(seen!.url).toContain(`/${number}?fields=display_phone_number,verified_name`);
    expect(seen!.auth).toBe(`Bearer ${TOKEN}`);
  });

  it("test records failed on a Graph error", async () => {
    const ctx = newCtx();
    await saveWhatsAppConnection(ctx, { phoneNumberId: newNumber(), businessAccountId: "1022901", accessToken: TOKEN, enabled: true });
    const unauthorized = (async () =>
      Response.json({ error: { message: "Invalid OAuth access token" } }, { status: 401 })) as unknown as typeof fetch;
    const failed = await testWhatsAppConnection(ctx, { fetchFn: unauthorized });
    expect(failed.lastTestResult).toBe("failed");
    expect(JSON.stringify(failed)).not.toContain("Invalid OAuth");

    const throwing = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(testWhatsAppConnection(ctx, { fetchFn: throwing })).resolves.toMatchObject({
      lastTestResult: "failed",
    });
  });

  it("refuses without ENCRYPTION_KEY", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    const ctx = newCtx();
    await expect(
      saveWhatsAppConnection(ctx, { phoneNumberId: newNumber(), businessAccountId: "1022901", accessToken: TOKEN, enabled: true }),
    ).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });
});
