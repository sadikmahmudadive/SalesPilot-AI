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
import { isValidIdSegment } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { assertOrgCtx, type OrgCtx } from "@/lib/org-context";
import { writeAuditInTransaction } from "@/lib/security/audit";
import { isEncryptionConfigured, sealSecret, unsealSecret } from "@/lib/security/secret-box";
import { createWhatsAppClient, type WhatsAppClient } from "@/lib/whatsapp/client";
import { ORGANIZATIONS } from "@/repositories/organizations";
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
  if (typeof parsed.accessToken !== "string")
    throw new Error("WhatsApp credentials are unreadable");
  return parsed.accessToken;
}

export async function getWhatsAppConnection(ctx: OrgCtx): Promise<WhatsAppConnectionSummary> {
  assertOrgCtx(ctx, "WhatsApp connection");
  return toConnectionSummary(await readConnection(ctx.organizationId), isPlatformWebhookReady());
}

export const META_REJECTED_MESSAGE =
  "Meta did not accept these details. Check the Phone Number ID, the Business Account ID and the access token.";

type MetaCheck =
  | { ok: true; displayPhoneNumber: string | null; verifiedName: string | null }
  | { ok: false; status: number | null };

/**
 * Proves the token controls the number: Meta must return the number itself (`id` equal to
 * `phoneNumberId`) AND list it among the business account's phone numbers. Any HTTP error, timeout
 * or mismatch is `ok: false`; Meta's error body is never passed on.
 */
async function checkWithMeta(
  phoneNumberId: string,
  businessAccountId: string,
  accessToken: string,
  fetchFn: typeof fetch,
): Promise<MetaCheck> {
  const base = `https://graph.facebook.com/${graphApiVersion()}`;
  const get = (path: string) =>
    fetchFn(`${base}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
  try {
    const numberRes = await get(
      `/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name`,
    );
    if (!numberRes.ok) return { ok: false, status: numberRes.status };
    const number = (await numberRes.json()) as Record<string, unknown>;
    if (number.id !== phoneNumberId) return { ok: false, status: numberRes.status };

    const listRes = await get(
      `/${encodeURIComponent(businessAccountId)}/phone_numbers?fields=id&limit=100`,
    );
    if (!listRes.ok) return { ok: false, status: listRes.status };
    const list = (await listRes.json()) as { data?: Array<{ id?: unknown }> };
    if (!Array.isArray(list.data) || !list.data.some((n) => n?.id === phoneNumberId)) {
      return { ok: false, status: listRes.status };
    }
    const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 120) : null);
    return {
      ok: true,
      displayPhoneNumber: text(number.display_phone_number),
      verifiedName: text(number.verified_name),
    };
  } catch {
    return { ok: false, status: null };
  }
}

/**
 * Creates or updates the workspace's number. A save that sets a new number, token or business
 * account is VERIFIED with Meta first (`checkWithMeta`): an unproven number can never be claimed,
 * so a workspace cannot take over another number's messages. The env single-number setup's number
 * can only be connected by its env owner (`WHATSAPP_ORGANIZATION_ID`).
 */
export async function saveWhatsAppConnection(
  ctx: OrgCtx,
  input: WhatsAppConnectionInput,
  deps: { fetchFn?: typeof fetch } = {},
): Promise<WhatsAppConnectionSummary> {
  assertOrgCtx(ctx, "WhatsApp connection");
  if (!isEncryptionConfigured()) throw new IntegrationNotConfiguredError("encryption");
  const orgId = ctx.organizationId;
  const env = getServerEnv();
  if (
    env.WHATSAPP_PHONE_NUMBER_ID === input.phoneNumberId &&
    env.WHATSAPP_ORGANIZATION_ID !== orgId
  ) {
    throw new ConflictError(NUMBER_TAKEN_MESSAGE);
  }
  const ref = connectionRef(orgId);
  const newLock = phoneLockRef(input.phoneNumberId);

  // Verify with Meta outside the transaction (a network call), then re-check inside it.
  const before = await readConnection(orgId);
  if (!before && input.accessToken === undefined) {
    throw new ValidationError([{ path: "accessToken", message: "Enter the access token" }]);
  }
  const ownerBefore: unknown = (await newLock.get()).get("organizationId");
  if (ownerBefore !== undefined && ownerBefore !== orgId) {
    throw new ConflictError(NUMBER_TAKEN_MESSAGE);
  }
  const needsCheck =
    !before ||
    before.phoneNumberId !== input.phoneNumberId ||
    before.businessAccountId !== input.businessAccountId ||
    input.accessToken !== undefined;
  let verified: Extract<MetaCheck, { ok: true }> | null = null;
  if (needsCheck) {
    const token = input.accessToken ?? accessTokenOf(before!);
    const check = await checkWithMeta(
      input.phoneNumberId,
      input.businessAccountId,
      token,
      deps.fetchFn ?? fetch,
    );
    if (!check.ok) {
      logger.warn("whatsapp.connection.save_rejected", {
        organizationId: orgId,
        phoneNumberId: input.phoneNumberId,
        status: check.status,
      });
      throw new ValidationError(
        [{ path: "accessToken", message: META_REJECTED_MESSAGE }],
        META_REJECTED_MESSAGE,
      );
    }
    verified = check;
  }

  const saved = await adminDb().runTransaction(async (tx) => {
    const [snap, lockSnap] = await Promise.all([tx.get(ref), tx.get(newLock)]);
    const existing = snap.exists ? (snap.data() as WhatsAppConnectionDoc) : null;
    if (existing && existing.organizationId !== orgId) throw new NotFoundError();
    // What Meta verified must still be what is stored (no concurrent save in between).
    if ((existing?.updatedAt ?? null) !== (before?.updatedAt ?? null)) {
      throw new ConflictError("The WhatsApp connection changed while saving. Try again.");
    }
    const owner: unknown = lockSnap.exists ? lockSnap.get("organizationId") : undefined;
    if (owner !== undefined && owner !== orgId) throw new ConflictError(NUMBER_TAKEN_MESSAGE);

    const now = new Date().toISOString();
    const numberChanged = existing !== null && existing.phoneNumberId !== input.phoneNumberId;
    const doc: WhatsAppConnectionDoc = {
      organizationId: orgId,
      phoneNumberId: input.phoneNumberId,
      businessAccountId: input.businessAccountId,
      displayPhoneNumber: verified
        ? verified.displayPhoneNumber
        : (existing?.displayPhoneNumber ?? null),
      verifiedName: verified ? verified.verifiedName : (existing?.verifiedName ?? null),
      credentials:
        input.accessToken !== undefined
          ? sealSecret(JSON.stringify({ accessToken: input.accessToken }))
          : existing!.credentials,
      enabled: input.enabled,
      lastTestedAt: verified ? now : (existing?.lastTestedAt ?? null),
      lastTestResult: verified ? "ok" : (existing?.lastTestResult ?? null),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (numberChanged && existing) tx.delete(phoneLockRef(existing.phoneNumberId));
    tx.set(newLock, { organizationId: orgId });
    tx.set(ref, doc);
    writeAuditInTransaction(tx, {
      organizationId: orgId,
      actorUid: ctx.uid,
      action: "whatsapp.connection.save",
      resource: "whatsappConnection",
      resourceId: orgId,
      after: {
        phoneNumberId: doc.phoneNumberId,
        businessAccountId: doc.businessAccountId,
        enabled: doc.enabled,
        tokenChanged: input.accessToken !== undefined,
      },
    });
    return doc;
  });

  return toConnectionSummary(saved, isPlatformWebhookReady());
}

/**
 * Re-checks the stored number and token with Meta and records the outcome. Never throws for a Meta
 * or network failure: that is `failed`, and Meta's error body is not passed on. The result is
 * written only if the connection is unchanged since it was read (a save or disconnect during the
 * call wins; the current state is returned).
 */
export async function testWhatsAppConnection(
  ctx: OrgCtx,
  deps: { fetchFn?: typeof fetch } = {},
): Promise<WhatsAppConnectionSummary> {
  assertOrgCtx(ctx, "WhatsApp connection");
  if (!isEncryptionConfigured()) throw new IntegrationNotConfiguredError("encryption");
  const doc = await readConnection(ctx.organizationId);
  if (!doc) throw new NotFoundError();

  const check = await checkWithMeta(
    doc.phoneNumberId,
    doc.businessAccountId,
    accessTokenOf(doc),
    deps.fetchFn ?? fetch,
  );
  if (!check.ok) {
    logger.warn("whatsapp.connection.test_failed", {
      organizationId: ctx.organizationId,
      phoneNumberId: doc.phoneNumberId,
      status: check.status,
    });
  }

  const ref = connectionRef(ctx.organizationId);
  const current = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const now = snap.data() as WhatsAppConnectionDoc;
    if (now.organizationId !== ctx.organizationId) return null;
    if (now.updatedAt !== doc.updatedAt || now.phoneNumberId !== doc.phoneNumberId) return now;
    const at = new Date().toISOString();
    const patch: Partial<WhatsAppConnectionDoc> = check.ok
      ? {
          lastTestResult: "ok",
          lastTestedAt: at,
          displayPhoneNumber: check.displayPhoneNumber,
          verifiedName: check.verifiedName,
        }
      : { lastTestResult: "failed", lastTestedAt: at };
    tx.update(ref, patch);
    return { ...now, ...patch };
  });
  return toConnectionSummary(current, isPlatformWebhookReady());
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

// ---- routing and sending --------------------------------------------------------------------

/**
 * The workspace a message sent to `phoneNumberId` belongs to, or null (dropped):
 *   1. the workspace whose ENABLED connection holds the number's lock;
 *   2. otherwise the env single-number setup (`WHATSAPP_PHONE_NUMBER_ID` owned by
 *      `WHATSAPP_ORGANIZATION_ID`, an existing organization), only when no lock claims the number.
 * A locked number whose connection is disabled is dropped, never handed to the env owner.
 */
export async function resolveWhatsAppOrg(
  phoneNumberId: string | undefined,
): Promise<string | null> {
  if (!phoneNumberId || !isValidIdSegment(phoneNumberId)) return null;
  const lock = await phoneLockRef(phoneNumberId).get();
  if (lock.exists) {
    const orgId: unknown = lock.get("organizationId");
    if (typeof orgId !== "string" || !isValidIdSegment(orgId)) return null;
    const doc = await readConnection(orgId);
    if (doc && doc.enabled && doc.phoneNumberId === phoneNumberId) return orgId;
    logger.warn("whatsapp.webhook.number_disabled", { phoneNumberId });
    return null;
  }
  const env = getServerEnv();
  if (env.WHATSAPP_PHONE_NUMBER_ID !== phoneNumberId) {
    logger.warn("whatsapp.webhook.unknown_number", { phoneNumberId });
    return null;
  }
  const orgId = env.WHATSAPP_ORGANIZATION_ID;
  if (!orgId || !isValidIdSegment(orgId)) {
    logger.warn("whatsapp.webhook.no_organization", { phoneNumberId });
    return null;
  }
  const org = await adminDb().collection(ORGANIZATIONS).doc(orgId).get();
  if (!org.exists) {
    logger.warn("whatsapp.webhook.organization_missing", { phoneNumberId });
    return null;
  }
  return orgId;
}

/**
 * The client that sends WhatsApp messages for `orgId`: its enabled connection's number and token,
 * else the env number when the env names this workspace as its owner, else null (not connected).
 */
export async function whatsappClientFor(
  orgId: string,
  deps: { fetchFn?: typeof fetch; phoneNumberId?: string | null } = {},
): Promise<WhatsAppClient | null> {
  // With `phoneNumberId` (the number a conversation came in on) only that number may send.
  const wanted = deps.phoneNumberId ?? null;
  const doc = await readConnection(orgId);
  if (doc && (wanted === null || doc.phoneNumberId === wanted)) {
    if (!doc.enabled) return null;
    return createWhatsAppClient({
      accessToken: accessTokenOf(doc),
      phoneNumberId: doc.phoneNumberId,
      apiVersion: graphApiVersion(),
      ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
    });
  }
  const env = getServerEnv();
  if (
    env.WHATSAPP_ORGANIZATION_ID === orgId &&
    env.WHATSAPP_PHONE_NUMBER_ID &&
    env.WHATSAPP_ACCESS_TOKEN &&
    (wanted === null ? !doc : env.WHATSAPP_PHONE_NUMBER_ID === wanted)
  ) {
    return createWhatsAppClient({
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      apiVersion: graphApiVersion(),
      ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
    });
  }
  return null;
}
