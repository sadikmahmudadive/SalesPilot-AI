/**
 * Per-organization order settings (delivery charges, hold durations). Server-only.
 *
 * `orderSettings/{orgId}` holds `{ organizationId, ...OrderSettings, createdAt, updatedAt }`.
 * A missing document means the defaults. A malformed stored document never breaks ordering:
 * the result is the defaults merged with every stored field that individually passes
 * `orderSettingsSchema`. An update merges a validated partial patch over that effective value
 * and writes an audit row in the same transaction.
 */
import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { isValidIdSegment } from "@/lib/ids";
import { assertOrgCtx } from "@/lib/org-context";
import { writeAuditInTransaction } from "@/lib/security/audit";
import { invalid } from "@/lib/validation-error";
import { ValidationError } from "@/lib/errors";
import { settingsRef } from "@/repositories/orders";
import { DEFAULT_ORDER_SETTINGS, orderSettingsSchema, type OrderSettings } from "@/schemas/order";

/** Who performed an order operation. `actor` is absent for a signed-in staff member. */
export interface OrderCtx {
  organizationId: string;
  uid: string;
  actor?: { kind: "ai"; agentId: string; sessionId: string } | { kind: "system"; id: string };
}

const KEYS = Object.keys(DEFAULT_ORDER_SETTINGS) as Array<keyof OrderSettings>;
const patchSchema = orderSettingsSchema.partial();

/** Defaults overlaid with every stored field that individually passes its own field schema. */
function effectiveSettings(stored: Record<string, unknown> | undefined): OrderSettings {
  const out: OrderSettings = { ...DEFAULT_ORDER_SETTINGS };
  if (!stored) return out;
  for (const key of KEYS) {
    const parsed = orderSettingsSchema.shape[key].safeParse(stored[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}

export async function getOrderSettings(orgId: string): Promise<OrderSettings> {
  if (!isValidIdSegment(orgId)) throw invalid("organizationId", "Invalid id");
  const snap = await settingsRef(orgId).get();
  const data = snap.exists ? snap.data() : undefined;
  return effectiveSettings(data && data.organizationId === orgId ? data : undefined);
}

export async function updateOrderSettings(
  ctx: OrderCtx,
  patch: Partial<OrderSettings>,
): Promise<OrderSettings> {
  assertOrgCtx(ctx, "Order settings");
  const parsed = patchSchema.safeParse(patch);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => ({ path: i.path.join(".") || "patch", message: i.message })),
    );
  }
  const changes = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  ) as Partial<OrderSettings>;
  if (Object.keys(changes).length === 0) throw invalid("patch", "At least one field is required");

  const ref = settingsRef(ctx.organizationId);
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : undefined;
    if (data && data.organizationId !== ctx.organizationId) {
      // A doc at our id that belongs to someone else is corrupt; never overwrite it silently.
      throw new Error("Order settings document does not belong to this organization");
    }
    const before = effectiveSettings(data);
    const after: OrderSettings = { ...before, ...changes };
    tx.set(ref, {
      organizationId: ctx.organizationId,
      ...after,
      createdAt: snap.exists
        ? (data?.createdAt ?? FieldValue.serverTimestamp())
        : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAuditInTransaction(tx, {
      organizationId: ctx.organizationId,
      actorUid: ctx.uid,
      action: "orderSettings.update",
      resource: "orderSettings",
      resourceId: ctx.organizationId,
      before,
      after,
    });
    return after;
  });
}
