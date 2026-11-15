import { withApi } from "@/lib/api/handler";
import { listAutomationRuns } from "@/repositories/automations";
import { AUTOMATION_RUN_STATUSES, type AutomationRunStatus } from "@/schemas/automation";
import { evaluateOrganizationAutomations } from "@/services/automations/sweep";

export const dynamic = "force-dynamic";

export const GET = withApi(
  { permission: "automations:read" },
  async ({ req, organizationId }) => {
    const sp = new URL(req.url).searchParams;
    const ruleId = sp.get("ruleId") ?? undefined;
    const rawStatus = sp.get("status");
    const limitParam = Number(sp.get("limit") ?? "50");

    const status =
      rawStatus && (AUTOMATION_RUN_STATUSES as readonly string[]).includes(rawStatus)
        ? (rawStatus as AutomationRunStatus)
        : undefined;

    const items = await listAutomationRuns(organizationId, {
      ruleId,
      status,
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50,
    });

    return { items };
  },
);

export const POST = withApi(
  {
    permission: "automations:write",
    rateLimit: { name: "automations.sweep", limit: 15, windowSec: 60 },
  },
  async ({ organizationId, uid }) => {
    const counts = await evaluateOrganizationAutomations(organizationId, new Date(), uid);
    return { data: counts };
  },
);
