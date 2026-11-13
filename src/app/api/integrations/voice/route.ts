import { withApi } from "@/lib/api/handler";
import { sealSecret } from "@/lib/security/secret-box";
import { createVoiceAccount, listVoiceAccounts } from "@/repositories/voice";
import { createVoiceAccountInputSchema, toVoiceSummary } from "@/schemas/voice";

export const dynamic = "force-dynamic";

export const GET = withApi(
  { permission: "voice:read" },
  async ({ organizationId }) => {
    const accounts = await listVoiceAccounts(organizationId);
    return { items: accounts.map(toVoiceSummary) };
  },
);

export const POST = withApi(
  {
    permission: "integrations:manage",
    schema: createVoiceAccountInputSchema,
    rateLimit: { name: "integrations.voice.create", limit: 30, windowSec: 60 },
  },
  async ({ body, organizationId }) => {
    const sealedCredentials = sealSecret(JSON.stringify(body.credentials ?? {}));
    const sealedWebhookSecret = body.webhookSecret ? sealSecret(body.webhookSecret) : undefined;

    const account = await createVoiceAccount({
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
    return Response.json({ data: toVoiceSummary(account) }, { status: 201 });
  },
);
