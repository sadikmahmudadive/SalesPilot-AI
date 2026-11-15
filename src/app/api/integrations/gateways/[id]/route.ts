import { withApi } from "@/lib/api/handler";
import { NotFoundError } from "@/lib/errors";
import { sealSecret } from "@/lib/security/secret-box";
import {
  deleteGatewayAccount,
  getGatewayAccount,
  updateGatewayAccount,
} from "@/repositories/integrations";
import {
  gatewayAccountPatchSchema,
  toGatewaySummary,
  type GatewayAccount,
} from "@/schemas/integration";

export const dynamic = "force-dynamic";

export const GET = withApi(
  { permission: "integrations:manage" },
  async ({ params, organizationId }) => {
    const id = params.id ?? "";
    const account = await getGatewayAccount(organizationId, id);
    if (!account) throw new NotFoundError("Gateway account not found");
    return { data: toGatewaySummary(account) };
  },
);

export const PATCH = withApi(
  {
    permission: "integrations:manage",
    schema: gatewayAccountPatchSchema,
    rateLimit: { name: "integrations.gateways.update", limit: 30, windowSec: 60 },
  },
  async ({ params, body, organizationId }) => {
    const id = params.id ?? "";
    const patch: Partial<Omit<GatewayAccount, "id" | "organizationId" | "createdAt">> = {};

    if (body.label !== undefined) patch.label = body.label;
    if (body.mode !== undefined) patch.mode = body.mode;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.isDefault !== undefined) patch.isDefault = body.isDefault;
    if (body.publicConfig !== undefined) patch.publicConfig = body.publicConfig;
    if (body.credentials !== undefined) {
      patch.credentials = sealSecret(JSON.stringify(body.credentials));
    }

    const updated = await updateGatewayAccount(organizationId, id, patch);
    return { data: toGatewaySummary(updated) };
  },
);

export const DELETE = withApi(
  {
    permission: "integrations:manage",
    rateLimit: { name: "integrations.gateways.delete", limit: 30, windowSec: 60 },
  },
  async ({ params, organizationId }) => {
    const id = params.id ?? "";
    await deleteGatewayAccount(organizationId, id);
    return { ok: true };
  },
);
