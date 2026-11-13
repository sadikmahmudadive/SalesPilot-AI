import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createAutomationRule,
  deleteAutomationRule,
  getAutomationRule,
  hasExistingRunForDedupeKey,
  listAutomationRules,
  listAutomationRuns,
  recordAutomationRun,
  updateAutomationRule,
} from "./automations";

describe("automations repository (integration)", () => {
  it("enforces tenant isolation on CRUD and updates stats + dedupe keys on runs", async () => {
    const orgA = `org_auto_a_${randomUUID().slice(0, 8)}`;
    const orgB = `org_auto_b_${randomUUID().slice(0, 8)}`;

    const ruleA = await createAutomationRule({
      organizationId: orgA,
      name: "Stale Draft Follow-up",
      description: "Wait 30m before pinging",
      enabled: true,
      trigger: "draft_order_stale",
      triggerConfig: { delayMinutes: 30 },
      action: "send_whatsapp",
      actionConfig: { messageTemplate: "Hi {{customerName}}!" },
      createdBy: "u_owner",
    });

    expect(await listAutomationRules(orgA)).toHaveLength(1);
    expect(await listAutomationRules(orgB)).toHaveLength(0);
    expect(await getAutomationRule(orgB, ruleA.id)).toBeNull();

    const dedupeKey = `${ruleA.id}:order:ord_1`;
    expect(await hasExistingRunForDedupeKey(orgA, dedupeKey)).toBe(false);

    await recordAutomationRun({
      organizationId: orgA,
      ruleId: ruleA.id,
      ruleName: ruleA.name,
      trigger: ruleA.trigger,
      action: ruleA.action,
      status: "succeeded",
      targetType: "order",
      targetId: "ord_1",
      dedupeKey,
      summary: "Sent WhatsApp follow-up",
      actorUid: "u_owner",
    });

    await recordAutomationRun({
      organizationId: orgA,
      ruleId: ruleA.id,
      ruleName: ruleA.name,
      trigger: ruleA.trigger,
      action: ruleA.action,
      status: "skipped",
      targetType: "order",
      targetId: "ord_2",
      dedupeKey: `${ruleA.id}:order:ord_2`,
      summary: "Customer opted out",
      actorUid: "u_owner",
    });

    expect(await hasExistingRunForDedupeKey(orgA, dedupeKey)).toBe(true);
    expect(await hasExistingRunForDedupeKey(orgB, dedupeKey)).toBe(false);

    const updatedRule = await getAutomationRule(orgA, ruleA.id);
    expect(updatedRule?.stats.totalRuns).toBe(2);
    expect(updatedRule?.stats.succeededRuns).toBe(1);
    expect(updatedRule?.stats.skippedRuns).toBe(1);
    expect(updatedRule?.stats.failedRuns).toBe(0);

    const runsA = await listAutomationRuns(orgA, { ruleId: ruleA.id });
    expect(runsA).toHaveLength(2);
    expect(await listAutomationRuns(orgB)).toHaveLength(0);

    const renamed = await updateAutomationRule(orgA, ruleA.id, {
      name: "Renamed Rule",
      enabled: false,
    });
    expect(renamed.name).toBe("Renamed Rule");
    expect(renamed.enabled).toBe(false);

    await deleteAutomationRule(orgA, ruleA.id);
    expect(await getAutomationRule(orgA, ruleA.id)).toBeNull();
  });
});
