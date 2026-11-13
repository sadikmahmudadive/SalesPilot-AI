import { z } from "zod";

import { CUSTOMER_SEGMENTS } from "./customer";
import { sealedSecretSchema } from "./integration";

export const AUTOMATION_TRIGGERS = [
  "draft_order_stale",
  "order_confirmed",
  "order_delivered",
  "customer_inactive",
  "inventory_low_stock",
  "inbound_webhook",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const AUTOMATION_ACTIONS = [
  "send_whatsapp",
  "place_voice_call",
  "update_customer",
  "outbound_webhook",
] as const;
export type AutomationAction = (typeof AUTOMATION_ACTIONS)[number];

export const AUTOMATION_RUN_STATUSES = ["succeeded", "failed", "skipped"] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

export const AUTOMATION_TARGET_TYPES = [
  "order",
  "customer",
  "product",
  "webhook",
  "manual",
] as const;
export type AutomationTargetType = (typeof AUTOMATION_TARGET_TYPES)[number];

export const TRIGGER_LABELS: Readonly<Record<AutomationTrigger, string>> = {
  draft_order_stale: "Stale Draft Order",
  order_confirmed: "Order Confirmed",
  order_delivered: "Order Delivered",
  customer_inactive: "Inactive Customer",
  inventory_low_stock: "Low Stock Alert",
  inbound_webhook: "Inbound Webhook (n8n)",
};

export const ACTION_LABELS: Readonly<Record<AutomationAction, string>> = {
  send_whatsapp: "Send WhatsApp Message",
  place_voice_call: "Place AI Voice Call",
  update_customer: "Update Customer CRM",
  outbound_webhook: "Send Signed Webhook (n8n)",
};

export const triggerConfigSchema = z.object({
  delayMinutes: z.number().int().min(1).max(10080).optional(),
  inactiveDays: z.number().int().min(1).max(365).optional(),
  lowStockThreshold: z.number().int().min(0).max(10000).optional(),
});
export type TriggerConfig = z.infer<typeof triggerConfigSchema>;

const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .refine(
    (u) => u.startsWith("https://") || u.startsWith("http://"),
    "Webhook URL must start with http:// or https://",
  );

export const actionConfigSchema = z.object({
  messageTemplate: z.string().trim().min(1).max(1000).optional(),
  callPurpose: z.string().trim().min(1).max(200).optional(),
  agentId: z.string().trim().min(1).max(80).optional(),
  addTags: z.array(z.string().trim().min(1).max(32)).max(10).optional(),
  segment: z.enum(CUSTOMER_SEGMENTS).optional(),
  webhookUrl: httpUrlSchema.optional(),
});
export type ActionConfig = z.infer<typeof actionConfigSchema>;

export const automationStatsSchema = z.object({
  totalRuns: z.number().int().min(0).default(0),
  succeededRuns: z.number().int().min(0).default(0),
  failedRuns: z.number().int().min(0).default(0),
  skippedRuns: z.number().int().min(0).default(0),
  lastRunAt: z.custom<unknown>().optional(),
});

export const automationRuleSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  enabled: z.boolean(),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  triggerConfig: triggerConfigSchema,
  action: z.enum(AUTOMATION_ACTIONS),
  actionConfig: actionConfigSchema,
  webhookSecret: sealedSecretSchema.optional(),
  stats: automationStatsSchema,
  createdBy: z.string(),
  createdAt: z.custom<unknown>(),
  updatedAt: z.custom<unknown>(),
});
export type AutomationRule = z.infer<typeof automationRuleSchema>;

export const automationRuleSummarySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  enabled: z.boolean(),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  triggerConfig: triggerConfigSchema,
  action: z.enum(AUTOMATION_ACTIONS),
  actionConfig: actionConfigSchema,
  hasWebhookSecret: z.boolean(),
  inboundWebhookUrl: z.string(),
  stats: z.object({
    totalRuns: z.number(),
    succeededRuns: z.number(),
    failedRuns: z.number(),
    skippedRuns: z.number(),
    lastRunAt: z.string().nullable().optional(),
  }),
  createdBy: z.string(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
});
export type AutomationRuleSummary = z.infer<typeof automationRuleSummarySchema>;

function validateActionRequirements(
  data: { action?: AutomationAction; actionConfig?: ActionConfig },
  ctx: z.RefinementCtx,
) {
  if (!data.action) return;
  const cfg = data.actionConfig ?? {};
  if (data.action === "send_whatsapp" && !cfg.messageTemplate?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["actionConfig", "messageTemplate"],
      message: "Message template is required for Send WhatsApp action",
    });
  }
  if (data.action === "outbound_webhook" && !cfg.webhookUrl?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["actionConfig", "webhookUrl"],
      message: "Webhook URL is required for Outbound Webhook action",
    });
  }
  if (
    data.action === "update_customer" &&
    (!cfg.addTags || cfg.addTags.length === 0) &&
    !cfg.segment
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["actionConfig"],
      message: "Provide at least one tag or target segment for Update Customer action",
    });
  }
}

export const createAutomationRuleInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80),
    description: z.string().trim().max(300).optional(),
    enabled: z.boolean().default(true),
    trigger: z.enum(AUTOMATION_TRIGGERS),
    triggerConfig: triggerConfigSchema.default({}),
    action: z.enum(AUTOMATION_ACTIONS),
    actionConfig: actionConfigSchema.default({}),
    webhookSecret: z.string().trim().max(200).optional(),
  })
  .superRefine(validateActionRequirements);
export type CreateAutomationRuleInput = z.infer<typeof createAutomationRuleInputSchema>;

export const updateAutomationRuleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(300).nullable().optional(),
    enabled: z.boolean().optional(),
    trigger: z.enum(AUTOMATION_TRIGGERS).optional(),
    triggerConfig: triggerConfigSchema.optional(),
    action: z.enum(AUTOMATION_ACTIONS).optional(),
    actionConfig: actionConfigSchema.optional(),
    webhookSecret: z.string().trim().max(200).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field must be updated");
export type UpdateAutomationRuleInput = z.infer<typeof updateAutomationRuleInputSchema>;

export const triggerAutomationInputSchema = z.object({
  customerId: z.string().trim().min(1).optional(),
  orderId: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(1).optional(),
  variables: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
export type TriggerAutomationInput = z.infer<typeof triggerAutomationInputSchema>;

export const automationRunSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  ruleId: z.string(),
  ruleName: z.string(),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  action: z.enum(AUTOMATION_ACTIONS),
  status: z.enum(AUTOMATION_RUN_STATUSES),
  targetType: z.enum(AUTOMATION_TARGET_TYPES),
  targetId: z.string().nullable().optional(),
  dedupeKey: z.string().nullable().optional(),
  summary: z.string(),
  errorMessage: z.string().nullable().optional(),
  actorUid: z.string(),
  createdAt: z.string(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

function toIso(ts: unknown): string | null {
  if (!ts) return null;
  if (typeof ts === "string") return ts;
  if (typeof (ts as { toDate?: () => Date }).toDate === "function") {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  const d = new Date(ts as string | number);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function toAutomationRuleSummary(rule: AutomationRule): AutomationRuleSummary {
  return {
    id: rule.id,
    organizationId: rule.organizationId,
    name: rule.name,
    description: rule.description ?? null,
    enabled: rule.enabled,
    trigger: rule.trigger,
    triggerConfig: rule.triggerConfig ?? {},
    action: rule.action,
    actionConfig: rule.actionConfig ?? {},
    hasWebhookSecret: Boolean(rule.webhookSecret),
    inboundWebhookUrl: `/api/webhooks/automations/${rule.id}`,
    stats: {
      totalRuns: rule.stats?.totalRuns ?? 0,
      succeededRuns: rule.stats?.succeededRuns ?? 0,
      failedRuns: rule.stats?.failedRuns ?? 0,
      skippedRuns: rule.stats?.skippedRuns ?? 0,
      lastRunAt: toIso(rule.stats?.lastRunAt),
    },
    createdBy: rule.createdBy,
    createdAt: toIso(rule.createdAt),
    updatedAt: toIso(rule.updatedAt),
  };
}

export interface AutomationTemplate {
  key: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  triggerConfig: TriggerConfig;
  action: AutomationAction;
  actionConfig: ActionConfig;
}

export const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  {
    key: "abandoned_draft_whatsapp",
    name: "Abandoned Draft Follow-up",
    description: "Follow up on WhatsApp when a draft order sits unconfirmed for 30+ minutes.",
    trigger: "draft_order_stale",
    triggerConfig: { delayMinutes: 30 },
    action: "send_whatsapp",
    actionConfig: {
      messageTemplate:
        "Hi {{customerName}}, your order #{{orderNumber}} (৳{{totalBdt}}) is still waiting! Reply YES to confirm delivery.",
    },
  },
  {
    key: "cod_order_voice_confirm",
    name: "COD Order Voice Confirmation",
    description: "Place an automated AI voice call to confirm newly confirmed COD orders.",
    trigger: "order_confirmed",
    triggerConfig: {},
    action: "place_voice_call",
    actionConfig: {
      callPurpose: "Confirm cash-on-delivery shipping address and delivery timing",
    },
  },
  {
    key: "delivered_vip_tagging",
    name: "Post-Delivery Repeat Customer Tagging",
    description: "Automatically tag customers as repeat buyers after an order is delivered.",
    trigger: "order_delivered",
    triggerConfig: {},
    action: "update_customer",
    actionConfig: {
      addTags: ["delivered-buyer", "follow-up-ready"],
      segment: "repeat_customer",
    },
  },
  {
    key: "n8n_order_sync",
    name: "n8n Order Sync Webhook",
    description: "Send a signed JSON webhook to n8n whenever an order is confirmed.",
    trigger: "order_confirmed",
    triggerConfig: {},
    action: "outbound_webhook",
    actionConfig: {
      webhookUrl: "https://your-n8n-instance.example/webhook/salespilot-orders",
    },
  },
  {
    key: "low_stock_restock_webhook",
    name: "Low Stock Restock Alert",
    description: "Trigger an n8n or Slack webhook when available product stock drops to 5 or less.",
    trigger: "inventory_low_stock",
    triggerConfig: { lowStockThreshold: 5 },
    action: "outbound_webhook",
    actionConfig: {
      webhookUrl: "https://your-n8n-instance.example/webhook/salespilot-low-stock",
    },
  },
];
