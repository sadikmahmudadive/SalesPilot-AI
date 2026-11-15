import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { NotFoundError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type {
  AutomationRule,
  AutomationRun,
  AutomationRunStatus,
} from "@/schemas/automation";

export const AUTOMATION_RULES = "automationRules";
export const AUTOMATION_RUNS = "automationRuns";

export function automationRulesRef() {
  return adminDb().collection(AUTOMATION_RULES);
}

export function automationRunsRef() {
  return adminDb().collection(AUTOMATION_RUNS);
}

function toMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === "string") {
    const t = Date.parse(ts);
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof (ts as { toMillis?: () => number }).toMillis === "function") {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export async function listAutomationRules(organizationId: string): Promise<AutomationRule[]> {
  const snap = await automationRulesRef()
    .where("organizationId", "==", organizationId)
    .get();

  const rules = snap.docs.map((d) => ({ ...(d.data() as AutomationRule), id: d.id }));
  return rules.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
}

export async function listAllEnabledAutomationRules(): Promise<AutomationRule[]> {
  const snap = await automationRulesRef().where("enabled", "==", true).get();
  return snap.docs.map((d) => ({ ...(d.data() as AutomationRule), id: d.id }));
}

export async function getAutomationRule(
  organizationId: string,
  id: string,
): Promise<AutomationRule | null> {
  const snap = await automationRulesRef().doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() as AutomationRule;
  if (data.organizationId !== organizationId) return null;
  return { ...data, id: snap.id };
}

export async function getAutomationRuleByIdGlobal(id: string): Promise<AutomationRule | null> {
  const snap = await automationRulesRef().doc(id).get();
  if (!snap.exists) return null;
  return { ...(snap.data() as AutomationRule), id: snap.id };
}

export async function createAutomationRule(
  data: Omit<AutomationRule, "id" | "stats" | "createdAt" | "updatedAt">,
): Promise<AutomationRule> {
  const ref = automationRulesRef().doc();
  const now = Timestamp.now();

  const payload: Record<string, unknown> = {
    organizationId: data.organizationId,
    name: data.name,
    enabled: data.enabled,
    trigger: data.trigger,
    triggerConfig: data.triggerConfig ?? {},
    action: data.action,
    actionConfig: data.actionConfig ?? {},
    stats: {
      totalRuns: 0,
      succeededRuns: 0,
      failedRuns: 0,
      skippedRuns: 0,
    },
    createdBy: data.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  if (data.description !== undefined) payload.description = data.description;
  if (data.webhookSecret !== undefined) payload.webhookSecret = data.webhookSecret;

  await ref.set(payload);
  return {
    ...(payload as unknown as AutomationRule),
    id: ref.id,
  };
}

export interface AutomationRulePatch {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  trigger?: AutomationRule["trigger"];
  triggerConfig?: AutomationRule["triggerConfig"];
  action?: AutomationRule["action"];
  actionConfig?: AutomationRule["actionConfig"];
  webhookSecret?: AutomationRule["webhookSecret"] | null;
}

export async function updateAutomationRule(
  organizationId: string,
  id: string,
  patch: AutomationRulePatch,
): Promise<AutomationRule> {
  const ref = automationRulesRef().doc(id);
  const existing = await ref.get();
  if (!existing.exists || (existing.data() as AutomationRule).organizationId !== organizationId) {
    throw new NotFoundError("Automation rule not found");
  }

  const updateData: Record<string, unknown> = {
    updatedAt: Timestamp.now(),
  };

  if (patch.name !== undefined) updateData.name = patch.name;
  if (patch.description === null) updateData.description = FieldValue.delete();
  else if (patch.description !== undefined) updateData.description = patch.description;
  if (patch.enabled !== undefined) updateData.enabled = patch.enabled;
  if (patch.trigger !== undefined) updateData.trigger = patch.trigger;
  if (patch.triggerConfig !== undefined) updateData.triggerConfig = patch.triggerConfig;
  if (patch.action !== undefined) updateData.action = patch.action;
  if (patch.actionConfig !== undefined) updateData.actionConfig = patch.actionConfig;
  if (patch.webhookSecret === null) updateData.webhookSecret = FieldValue.delete();
  else if (patch.webhookSecret !== undefined) updateData.webhookSecret = patch.webhookSecret;

  await ref.update(updateData);
  const updated = await ref.get();
  return { ...(updated.data() as AutomationRule), id: updated.id };
}

export async function deleteAutomationRule(organizationId: string, id: string): Promise<void> {
  const ref = automationRulesRef().doc(id);
  const existing = await ref.get();
  if (!existing.exists || (existing.data() as AutomationRule).organizationId !== organizationId) {
    throw new NotFoundError("Automation rule not found");
  }
  await ref.delete();
}

export async function hasExistingRunForDedupeKey(
  organizationId: string,
  dedupeKey: string,
): Promise<boolean> {
  const snap = await automationRunsRef()
    .where("organizationId", "==", organizationId)
    .where("dedupeKey", "==", dedupeKey)
    .limit(1)
    .get();
  return !snap.empty;
}

export async function recordAutomationRun(
  input: Omit<AutomationRun, "id" | "createdAt">,
): Promise<AutomationRun> {
  const db = adminDb();
  const runRef = automationRunsRef().doc();
  const ruleRef = automationRulesRef().doc(input.ruleId);
  const nowIso = new Date().toISOString();

  const runDoc: AutomationRun = {
    id: runRef.id,
    organizationId: input.organizationId,
    ruleId: input.ruleId,
    ruleName: input.ruleName,
    trigger: input.trigger,
    action: input.action,
    status: input.status,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    dedupeKey: input.dedupeKey ?? null,
    summary: input.summary,
    errorMessage: input.errorMessage ?? null,
    actorUid: input.actorUid,
    createdAt: nowIso,
  };

  await db.runTransaction(async (tx) => {
    const ruleSnap = await tx.get(ruleRef);
    tx.set(runRef, runDoc);

    if (ruleSnap.exists && (ruleSnap.data() as AutomationRule).organizationId === input.organizationId) {
      const counterField =
        input.status === "succeeded"
          ? "stats.succeededRuns"
          : input.status === "failed"
            ? "stats.failedRuns"
            : "stats.skippedRuns";

      tx.update(ruleRef, {
        "stats.totalRuns": FieldValue.increment(1),
        [counterField]: FieldValue.increment(1),
        "stats.lastRunAt": Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    }
  });

  return runDoc;
}

export async function listAutomationRuns(
  organizationId: string,
  opts: { ruleId?: string; status?: AutomationRunStatus; limit?: number } = {},
): Promise<AutomationRun[]> {
  let q = automationRunsRef().where("organizationId", "==", organizationId);
  if (opts.ruleId) q = q.where("ruleId", "==", opts.ruleId);
  if (opts.status) q = q.where("status", "==", opts.status);

  const snap = await q.get();
  const runs = snap.docs.map((d) => ({ ...(d.data() as AutomationRun), id: d.id }));
  runs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return runs.slice(0, limit);
}
