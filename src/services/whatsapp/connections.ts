/**
 * A workspace's connected WhatsApp business number. Server-only.
 *
 * MODEL (spec 2026-11-14). The platform runs ONE Meta app; its app secret and verify token stay in
 * env and the shared webhook verifies with them. Each workspace connects its own number: the
 * Phone Number ID, the WhatsApp Business Account ID and an access token for that number.
 *
 * OWNERSHIP. A number belongs to at most one workspace: `whatsappPhoneNumbers/{phoneNumberId}`
 * holds its owner and is written in the same transaction as the connection. Changing the number
 * moves the lock; disconnecting deletes both.
 *
 * SECRETS. The token is sealed with the secret box (`ENCRYPTION_KEY`), never returned (the summary
 * has `hasAccessToken` only), never logged, and kept out of the audit row.
 */
import "server-only";

import { getServerEnv } from "@/config/env";
import {
  ConflictError,
  IntegrationNotConfiguredError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { assertOrgCtx, type OrgCtx } from "@/lib/org-context";
import { writeAuditInTransaction } from "@/lib/security/audit";
import { isEncryptionConfigured, sealSecret, unsealSecret } from "@/lib/security/secret-box";
import { connectionRef, phoneLockRef } from "@/repositories/whatsapp-connections";
import {
  toConnectionSummary,
  type WhatsAppConnectionDoc,
  type WhatsAppConnectionInput,
  type WhatsAppConnectionSummary,
} from "@/schemas/whatsapp-connection";

export const NUMBER_TAKEN_MESSAGE = "This WhatsApp number is connected to another workspace.";
const TEST_TIMEOUT_MS = 10_000;

/** The platform's Meta app webhook is configured (env app secret + verify token). */
export function isPlatformWebhookReady(): boolean {
  const env = getServerEnv();
  return Boolean(env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN);
}

export function graphApiVersion(): string {
  return getServerEnv().META_GRAPH_API_VERSION ?? "v21.0";
}

/** The stored connection of `orgId`, or null (also null for a doc of another organization). */
export async function readConnection(orgId: string): Promise<WhatsAppConnectionDoc | null> {
  const snap = await connectionRef(orgId).get();
  if (!snap.exists) return null;
  const data = snap.data() as WhatsAppConnectionDoc;
  return data.organizationId === orgId ? data : null;
}

/** The connection's access token. Server-only; never return or log it. */
export function accessTokenOf(doc: WhatsAppConnectionDoc): string {
  const parsed = JSON.parse(unsealSecret(doc.credentials)) as { accessToken?: unknown };
  if (typeof parsed.accessToken !== "string") throw new Error("WhatsApp credentials are unreadable");
  return parsed.accessToken;
}

export async function getWhatsAppConnection(ctx: OrgCtx): Promise<WhatsAppConnectionSummary> {
  assertOrgCtx(ctx, "WhatsApp connection");
  return toConnectionSummary(await readConnection(ctx.organizationId), isPlatformWebhookReady());
}

export async function saveWhatsAppConnection(
  ctx: OrgCtx,
  input: WhatsAppConnectionInput,
): Promise<WhatsAppConnectionSummary> {
  assertOrgCtx(ctx, "WhatsApp connection");
  if (!isEncryptionConfigured()) throw new IntegrationNotConfiguredError("encryption");
  const orgId = ctx.organizationId;
  const ref = connectionRef(orgId);
  const newLock = phoneLockRef(input.phoneNumberId);

  const saved = await adminDb().runTransaction(async (tx) => {
    const [snap, lockSnap] = await Promise.all([tx.get(ref), tx.get(newLock)]);
    const existing = snap.exists ? (snap.data() as WhatsAppConnectionDoc) : null;
    if (existing && existing.organizationId !== orgId) throw new NotFoundError();
    const owner: unknown = lockSnap.exists ? lockSnap.get("organizationId") : undefined;
    if (owner !== undefined && owner !== orgId) throw new ConflictError(NUMBER_TAKEN_MESSAGE);
    if (!existing && input.accessToken === undefined) {
      throw new ValidationError([{ path: "accessToken", message: "Enter the access token" }]);
    }

    const now = new Date().toISOString();
    const numberChanged = existing !== null && existing.phoneNumberId !== input.phoneNumberId;
    // A new number or token invalidates what the last test learned.
    const retest = !existing || numberChanged || input.accessToken !== undefined;
    const doc: WhatsAppConnectionDoc = {
      organizationId: orgId,
      phoneNumberId: input.phoneNumberId,
      businessAccountId: input.businessAccountId,
      displayPhoneNumber: retest || !existing ? null : existing.displayPhoneNumber,
      verifiedName: retest || !existing ? null : existing.verifiedName,
      credentials:
        input.accessToken !== undefined
          ? sealSecret(JSON.stringify({ accessToken: input.accessToken }))
          : existing!.credentials,
      enabled: input.enabled,
      lastTestedAt: retest || !existing ? null : existing.lastTestedAt,
      lastTestResult: retest || !existing ? null : existing.lastTestResult,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (numberChanged && existing) tx.delete(phoneLockRef(existing.phoneNumberId));
    tx.set(newLock, { organizationId: orgId });
    tx.set(ref, doc);
    const summary = toConnectionSummary(doc, false);
    writeAuditInTransaction(tx, {
      organizationId: orgId,
      actorUid: ctx.uid,
      action: "whatsapp.connection.save",
      resource: "whatsappConnection",
      resourceId: orgId,
      after: {
        phoneNumberId: summary.phoneNumberId,
        businessAccountId: summary.businessAccountId,
        enabled: summary.enabled,
        tokenChanged: input.accessToken !== undefined,
      },
    });
    return doc;
  });

  return toConnectionSummary(saved, isPlatformWebhookReady());
}

/**
 * Asks Meta for the number's display phone and verified business name with the stored token and
 * records the outcome. Never throws for a Meta or network failure: that is `failed`, and Meta's
 * error body is not passed on.
 */
export async function testWhatsAppConnection(
  ctx: OrgCtx,
  deps: { fetchFn?: typeof fetch } = {},
): Promise<WhatsAppConnectionSummary> {
  assertOrgCtx(ctx, "WhatsApp connection");
  const doc = await readConnection(ctx.organizationId);
  if (!doc) throw new NotFoundError();
  const fetchFn = deps.fetchFn ?? fetch;

  let result: { ok: true; display: string | null; name: string | null } | { ok: false };
  let status: number | null = null;
  try {
    const url =
      `https://graph.facebook.com/${graphApiVersion()}/${encodeURIComponent(doc.phoneNumberId)}` +
      "?fields=display_phone_number,verified_name";
    const res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${accessTokenOf(doc)}` },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    status = res.status;
    if (!res.ok) {
      result = { ok: false };
    } else {
      const body = (await res.json()) as { display_phone_number?: unknown; verified_name?: unknown };
      const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 120) : null);
      result = { ok: true, display: text(body.display_phone_number), name: text(body.verified_name) };
    }
  } catch {
    result = { ok: false };
  }
  if (!result.ok) {
    logger.warn("whatsapp.connection.test_failed", { organizationId: ctx.organizationId, status });
  }

  const now = new Date().toISOString();
  const patch: Partial<WhatsAppConnectionDoc> = result.ok
    ? {
        lastTestResult: "ok",
        lastTestedAt: now,
        displayPhoneNumber: result.display,
        verifiedName: result.name,
      }
    : { lastTestResult: "failed", lastTestedAt: now };
  await connectionRef(ctx.organizationId).update(patch);
  return toConnectionSummary({ ...doc, ...patch }, isPlatformWebhookReady());
}

export async function disconnectWhatsApp(ctx: OrgCtx): Promise<void> {
  assertOrgCtx(ctx, "WhatsApp connection");
  const ref = connectionRef(ctx.organizationId);
  await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const doc = snap.data() as WhatsAppConnectionDoc;
    if (doc.organizationId !== ctx.organizationId) return;
    const lock = phoneLockRef(doc.phoneNumberId);
    const lockSnap = await tx.get(lock);
    if (lockSnap.exists && lockSnap.get("organizationId") === ctx.organizationId) tx.delete(lock);
    tx.delete(ref);
    writeAuditInTransaction(tx, {
      organizationId: ctx.organizationId,
      actorUid: ctx.uid,
      action: "whatsapp.connection.delete",
      resource: "whatsappConnection",
      resourceId: ctx.organizationId,
    });
  });
}
