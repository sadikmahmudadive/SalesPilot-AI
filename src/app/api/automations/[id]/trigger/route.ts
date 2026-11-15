import { withApi } from "@/lib/api/handler";
import { NotFoundError } from "@/lib/errors";
import { getAutomationRule } from "@/repositories/automations";
import { triggerAutomationInputSchema } from "@/schemas/automation";
import { executeAutomationRule } from "@/services/automations/engine";

export const dynamic = "force-dynamic";

export const POST = withApi(
  {
    permission: "automations:write",
    schema: triggerAutomationInputSchema,
    rateLimit: { name: "automations.trigger", limit: 30, windowSec: 60 },
  },
  async ({ req, params, body, organizationId, uid }) => {
    const id = params.id ?? "";
    const rule = await getAutomationRule(organizationId, id);
    if (!rule) throw new NotFoundError("Automation rule not found");

    const originUrl = new URL(req.url).origin;
    const run = await executeAutomationRule(rule, {
      targetType: body.orderId
        ? "order"
        : body.customerId
          ? "customer"
          : body.productId
            ? "product"
            : "manual",
      targetId: body.orderId ?? body.customerId ?? body.productId ?? rule.id,
      customerId: body.customerId,
      orderId: body.orderId,
      productId: body.productId,
      phone: body.phone,
      variables: body.variables,
      force: true,
      actorUid: uid,
      originUrl,
    });

    return { data: run };
  },
);
