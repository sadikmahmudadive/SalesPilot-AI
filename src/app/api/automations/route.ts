import { withApi } from "@/lib/api/handler";
import { sealSecret } from "@/lib/security/secret-box";
import { createAutomationRule, listAutomationRules } from "@/repositories/automations";
import {
  AUTOMATION_TEMPLATES,
  createAutomationRuleInputSchema,
  toAutomationRuleSummary,
} from "@/schemas/automation";

export const dynamic = "force-dynamic";

export const GET = withApi(
  { permission: "automations:read" },
  async ({ organizationId }) => {
    const rules = await listAutomationRules(organizationId);
    return {
      items: rules.map(toAutomationRuleSummary),
      templates: AUTOMATION_TEMPLATES,
    };
  },
);

export const POST = withApi(
  {
    permission: "automations:write",
    schema: createAutomationRuleInputSchema,
    rateLimit: { name: "automations.create", limit: 30, windowSec: 60 },
  },
  async ({ body, organizationId, uid }) => {
    const rule = await createAutomationRule({
      organizationId,
      name: body.name,
      description: body.description,
      enabled: body.enabled,
      trigger: body.trigger,
      triggerConfig: body.triggerConfig,
      action: body.action,
      actionConfig: body.actionConfig,
      webhookSecret:
        body.webhookSecret && body.webhookSecret.length > 0
          ? sealSecret(body.webhookSecret)
          : undefined,
      createdBy: uid,
    });

    return Response.json({ data: toAutomationRuleSummary(rule) }, { status: 201 });
  },
);
