import "server-only";

import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { unsealSecret } from "@/lib/security/secret-box";
import {
  getAutomationRuleByIdGlobal,
  listAllEnabledAutomationRules,
  listAutomationRules,
} from "@/repositories/automations";
import { CUSTOMERS, type CustomerDoc } from "@/repositories/customers";
import { ORDERS } from "@/repositories/orders";
import { INVENTORY } from "@/repositories/products";
import {
  triggerAutomationInputSchema,
  type AutomationRule,
  type AutomationRun,
} from "@/schemas/automation";
import type { InventoryRecord } from "@/schemas/inventory";
import type { Order } from "@/schemas/order";

import { executeAutomationRule } from "./engine";
import { verifySecretHeader } from "./helpers";

export interface AutomationSweepResult {
  evaluated: number;
  succeeded: number;
  skipped: number;
  failed: number;
}

function toMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof (ts as { toMillis?: () => number }).toMillis === "function") {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return 0;
}

async function evaluateSingleRule(
  rule: AutomationRule,
  now: Date,
  actorUid: string,
  counts: AutomationSweepResult,
): Promise<void> {
  if (!rule.enabled || rule.trigger === "inbound_webhook") return;

  const db = adminDb();
  const orgId = rule.organizationId;
  const nowMs = now.getTime();

  const tally = (run: AutomationRun | null) => {
    if (!run) return;
    counts.evaluated += 1;
    if (run.status === "succeeded") counts.succeeded += 1;
    else if (run.status === "skipped") counts.skipped += 1;
    else counts.failed += 1;
  };

  if (
    rule.trigger === "draft_order_stale" ||
    rule.trigger === "order_confirmed" ||
    rule.trigger === "order_delivered"
  ) {
    const targetStatus =
      rule.trigger === "draft_order_stale"
        ? "draft"
        : rule.trigger === "order_confirmed"
          ? "confirmed"
          : "delivered";

    const snap = await db
      .collection(ORDERS)
      .where("organizationId", "==", orgId)
      .where("status", "==", targetStatus)
      .limit(50)
      .get();

    const delayMs = (rule.triggerConfig.delayMinutes ?? 30) * 60_000;

    for (const doc of snap.docs) {
      const order = { ...(doc.data() as Order), id: doc.id };
      if (rule.trigger === "draft_order_stale") {
        const createdMs = toMillis(order.createdAt);
        if (createdMs === 0 || nowMs - createdMs < delayMs) continue;
      }
      const run = await executeAutomationRule(rule, {
        targetType: "order",
        targetId: order.id,
        orderId: order.id,
        customerId: order.customerId,
        dedupeKey: `${rule.id}:order:${order.id}`,
        actorUid,
      });
      tally(run);
    }
    return;
  }

  if (rule.trigger === "customer_inactive") {
    const inactiveDays = rule.triggerConfig.inactiveDays ?? 30;
    const cutoffMs = nowMs - inactiveDays * 24 * 60 * 60_000;
    const snap = await db
      .collection(CUSTOMERS)
      .where("organizationId", "==", orgId)
      .limit(100)
      .get();

    for (const doc of snap.docs) {
      const customer = { ...(doc.data() as CustomerDoc), id: doc.id };
      const lastTouch = toMillis(customer.lastInteractionAt) || toMillis(customer.createdAt);
      if (lastTouch === 0 || lastTouch > cutoffMs) continue;

      const run = await executeAutomationRule(rule, {
        targetType: "customer",
        targetId: customer.id,
        customerId: customer.id,
        dedupeKey: `${rule.id}:customer:${customer.id}`,
        actorUid,
      });
      tally(run);
    }
    return;
  }

  if (rule.trigger === "inventory_low_stock") {
    const threshold = rule.triggerConfig.lowStockThreshold ?? 5;
    const snap = await db
      .collection(INVENTORY)
      .where("organizationId", "==", orgId)
      .limit(100)
      .get();

    for (const doc of snap.docs) {
      const rec = { ...(doc.data() as InventoryRecord), id: doc.id };
      if (rec.available > threshold) continue;

      const run = await executeAutomationRule(rule, {
        targetType: "product",
        targetId: rec.productId,
        productId: rec.productId,
        dedupeKey: `${rule.id}:inventory:${rec.id}:${rec.available}`,
        variables: {
          availableStock: rec.available,
          variantId: rec.variantId,
        },
        actorUid,
      });
      tally(run);
    }
  }
}

export async function evaluateOrganizationAutomations(
  organizationId: string,
  now: Date = new Date(),
  actorUid: string = "system:sweep",
): Promise<AutomationSweepResult> {
  const counts: AutomationSweepResult = {
    evaluated: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
  };
  const rules = await listAutomationRules(organizationId);
  for (const rule of rules) {
    if (!rule.enabled) continue;
    try {
      await evaluateSingleRule(rule, now, actorUid, counts);
    } catch (err) {
      logger.error("automation_rule_sweep_failed", {
        ruleId: rule.id,
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  return counts;
}

export async function sweepAutomations(
  now: Date = new Date(),
  deadlineMs: number = Date.now() + 20_000,
): Promise<AutomationSweepResult> {
  const counts: AutomationSweepResult = {
    evaluated: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
  };
  const rules = await listAllEnabledAutomationRules();
  for (const rule of rules) {
    if (Date.now() > deadlineMs) break;
    try {
      await evaluateSingleRule(rule, now, "system:sweep", counts);
    } catch (err) {
      logger.error("automation_global_sweep_failed", {
        ruleId: rule.id,
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  return counts;
}

export async function handleInboundAutomationWebhook(
  ruleId: string,
  req: {
    headers: Record<string, string | undefined>;
    body: unknown;
    originUrl?: string;
  },
): Promise<AutomationRun | null> {
  const rule = await getAutomationRuleByIdGlobal(ruleId);
  if (!rule || !rule.enabled || rule.trigger !== "inbound_webhook") {
    throw new NotFoundError("Inbound automation webhook not found or disabled");
  }

  if (rule.webhookSecret) {
    const expectedSecret = unsealSecret(rule.webhookSecret);
    const provided = req.headers["x-automation-secret"] ?? req.headers["x-n8n-secret"];
    if (!verifySecretHeader(provided, expectedSecret)) {
      throw new ForbiddenError("Invalid automation webhook secret");
    }
  }

  const parsed = triggerAutomationInputSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new ValidationError(undefined, parsed.error.issues[0]?.message ?? "Invalid payload");
  }
  const input = parsed.data;

  return executeAutomationRule(rule, {
    targetType: "webhook",
    targetId: input.orderId ?? input.customerId ?? input.productId ?? rule.id,
    customerId: input.customerId,
    orderId: input.orderId,
    productId: input.productId,
    phone: input.phone,
    variables: input.variables,
    force: true,
    actorUid: "webhook:inbound",
    originUrl: req.originUrl,
  });
}
