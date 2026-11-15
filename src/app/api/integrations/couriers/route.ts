import { withApi } from "@/lib/api/handler";
import { sealSecret } from "@/lib/security/secret-box";
import { createCourierAccount, listCourierAccounts } from "@/repositories/couriers";
import {
  courierAccountInputSchema,
  toCourierSummary,
} from "@/schemas/courier";

export const dynamic = "force-dynamic";

export const GET = withApi(
  { permission: "orders:read" },
  async ({ organizationId }) => {
    const accounts = await listCourierAccounts(organizationId);
    return { items: accounts.map(toCourierSummary) };
  },
);

export const POST = withApi(
  {
    permission: "integrations:manage",
    schema: courierAccountInputSchema,
    rateLimit: { name: "integrations.couriers.create", limit: 30, windowSec: 60 },
  },
  async ({ body, organizationId }) => {
    const sealedCredentials = sealSecret(JSON.stringify(body.credentials ?? {}));
    const sealedWebhookSecret = body.webhookSecret ? sealSecret(body.webhookSecret) : undefined;

    const account = await createCourierAccount({
      organizationId,
      provider: body.provider,
      label: body.label,
      mode: body.mode,
      enabled: body.enabled,
      isDefault: body.isDefault,
      credentials: sealedCredentials,
      webhookSecret: sealedWebhookSecret,
      publicConfig: body.publicConfig,
    });
    return Response.json({ data: toCourierSummary(account) }, { status: 201 });
  },
);
