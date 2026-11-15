import { withApi } from "@/lib/api/handler";
import { sealSecret } from "@/lib/security/secret-box";
import { createGatewayAccount, listGatewayAccounts } from "@/repositories/integrations";
import {
  gatewayAccountInputSchema,
  toGatewaySummary,
} from "@/schemas/integration";

export const dynamic = "force-dynamic";

export const GET = withApi(
  { permission: "integrations:manage" },
  async ({ organizationId }) => {
    const accounts = await listGatewayAccounts(organizationId);
    return { items: accounts.map(toGatewaySummary) };
  },
);

export const POST = withApi(
  {
    permission: "integrations:manage",
    schema: gatewayAccountInputSchema,
    rateLimit: { name: "integrations.gateways.create", limit: 30, windowSec: 60 },
  },
  async ({ body, organizationId }) => {
    const sealedCredentials = sealSecret(JSON.stringify(body.credentials ?? {}));
    const account = await createGatewayAccount({
      organizationId,
      provider: body.provider,
      label: body.label,
      mode: body.mode,
      enabled: body.enabled,
      isDefault: body.isDefault,
      credentials: sealedCredentials,
      publicConfig: body.publicConfig,
    });
    return Response.json({ data: toGatewaySummary(account) }, { status: 201 });
  },
);
