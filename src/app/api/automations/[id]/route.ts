import { withApi } from "@/lib/api/handler";
import { NotFoundError } from "@/lib/errors";
import { sealSecret } from "@/lib/security/secret-box";
import {
  deleteAutomationRule,
  getAutomationRule,
  updateAutomationRule,
  type AutomationRulePatch,
} from "@/repositories/automations";
import {
  toAutomationRuleSummary,
  updateAutomationRuleInputSchema,
} from "@/schemas/automation";

export const dynamic = "force-dynamic";

export const GET = withApi(
  { permission: "automations:read" },
  async ({ params, organizationId }) => {
    const id = params.id ?? "";
    const rule = await getAutomationRule(organizationId, id);
    if (!rule) throw new NotFoundError("Automation rule not found");
    return { data: toAutomationRuleSummary(rule) };
  },
);

export const PATCH = withApi(
  {
    permission: "automations:write",
    schema: updateAutomationRuleInputSchema,
    rateLimit: { name: "automations.update", limit: 30, windowSec: 60 },
  },
  async ({ params, body, organizationId }) => {
    const id = params.id ?? "";
    const patch: AutomationRulePatch = {};

    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.trigger !== undefined) patch.trigger = body.trigger;
    if (body.triggerConfig !== undefined) patch.triggerConfig = body.triggerConfig;
    if (body.action !== undefined) patch.action = body.action;
    if (body.actionConfig !== undefined) patch.actionConfig = body.actionConfig;
    if (body.webhookSecret === null || body.webhookSecret === "") {
      patch.webhookSecret = null;
    } else if (body.webhookSecret !== undefined) {
      patch.webhookSecret = sealSecret(body.webhookSecret);
    }

    const updated = await updateAutomationRule(organizationId, id, patch);
    return { data: toAutomationRuleSummary(updated) };
  },
);

export const DELETE = withApi(
  {
    permission: "automations:write",
    rateLimit: { name: "automations.delete", limit: 30, windowSec: 60 },
  },
  async ({ params, organizationId }) => {
    const id = params.id ?? "";
    await deleteAutomationRule(organizationId, id);
    return { ok: true };
  },
);
