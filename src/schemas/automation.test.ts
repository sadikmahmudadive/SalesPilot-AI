import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import {
  AUTOMATION_TEMPLATES,
  createAutomationRuleInputSchema,
  toAutomationRuleSummary,
  type AutomationRule,
} from "./automation";

describe("automation schemas", () => {
  it("validates valid send_whatsapp and outbound_webhook rules and rejects missing action fields", () => {
    const valid = createAutomationRuleInputSchema.safeParse({
      name: "Draft Follow-up",
      trigger: "draft_order_stale",
      triggerConfig: { delayMinutes: 30 },
      action: "send_whatsapp",
      actionConfig: { messageTemplate: "Hi {{customerName}}!" },
    });
    expect(valid.success).toBe(true);

    const missingTemplate = createAutomationRuleInputSchema.safeParse({
      name: "Bad WhatsApp Rule",
      trigger: "draft_order_stale",
      action: "send_whatsapp",
      actionConfig: {},
    });
    expect(missingTemplate.success).toBe(false);

    const missingWebhookUrl = createAutomationRuleInputSchema.safeParse({
      name: "Bad Webhook Rule",
      trigger: "order_confirmed",
      action: "outbound_webhook",
      actionConfig: {},
    });
    expect(missingWebhookUrl.success).toBe(false);

    const missingCustomerUpdate = createAutomationRuleInputSchema.safeParse({
      name: "Bad CRM Rule",
      trigger: "order_delivered",
      action: "update_customer",
      actionConfig: {},
    });
    expect(missingCustomerUpdate.success).toBe(false);
  });

  it("strips sealed webhookSecret and sets inboundWebhookUrl in summary", () => {
    const rule: AutomationRule = {
      id: "rule_1",
      organizationId: "org_1",
      name: "n8n Trigger",
      description: "Runs from n8n",
      enabled: true,
      trigger: "inbound_webhook",
      triggerConfig: {},
      action: "send_whatsapp",
      actionConfig: { messageTemplate: "Hello {{customerName}}" },
      webhookSecret: { v: 1, iv: "iv", tag: "tag", data: "encrypted" },
      stats: {
        totalRuns: 4,
        succeededRuns: 3,
        failedRuns: 0,
        skippedRuns: 1,
        lastRunAt: Timestamp.fromMillis(1_700_000_000_000),
      },
      createdBy: "uid_1",
      createdAt: Timestamp.fromMillis(1_700_000_000_000),
      updatedAt: Timestamp.fromMillis(1_700_000_000_000),
    };

    const summary = toAutomationRuleSummary(rule);
    expect(summary.hasWebhookSecret).toBe(true);
    expect(summary.inboundWebhookUrl).toBe("/api/webhooks/automations/rule_1");
    expect((summary as unknown as Record<string, unknown>).webhookSecret).toBeUndefined();
    expect(summary.stats.lastRunAt).toBe("2023-11-14T22:13:20.000Z");
  });

  it("provides valid ready-to-use templates", () => {
    expect(AUTOMATION_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    for (const tpl of AUTOMATION_TEMPLATES) {
      const parsed = createAutomationRuleInputSchema.safeParse(tpl);
      expect(parsed.success).toBe(true);
    }
  });
});
