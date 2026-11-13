import { withApi } from "@/lib/api/handler";
import { NotFoundError } from "@/lib/errors";
import { sealSecret } from "@/lib/security/secret-box";
import {
  deleteVoiceAccount,
  getVoiceAccount,
  updateVoiceAccount,
} from "@/repositories/voice";
import {
  toVoiceSummary,
  updateVoiceAccountInputSchema,
  type VoiceAccount,
} from "@/schemas/voice";

export const dynamic = "force-dynamic";

export const GET = withApi(
  { permission: "voice:read" },
  async ({ params, organizationId }) => {
    const id = params.id ?? "";
    const account = await getVoiceAccount(organizationId, id);
    if (!account) throw new NotFoundError("Voice account not found");
    return { data: toVoiceSummary(account) };
  },
);

export const PATCH = withApi(
  {
    permission: "integrations:manage",
    schema: updateVoiceAccountInputSchema,
    rateLimit: { name: "integrations.voice.update", limit: 30, windowSec: 60 },
  },
  async ({ params, body, organizationId }) => {
    const id = params.id ?? "";
    const patch: Partial<Omit<VoiceAccount, "id" | "organizationId" | "createdAt">> = {};

    if (body.label !== undefined) patch.label = body.label;
    if (body.mode !== undefined) patch.mode = body.mode;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.isDefault !== undefined) patch.isDefault = body.isDefault;
    if (body.publicConfig !== undefined) patch.publicConfig = body.publicConfig;
    if (body.credentials !== undefined) {
      patch.credentials = sealSecret(JSON.stringify(body.credentials));
    }
    if (body.webhookSecret !== undefined) {
      patch.webhookSecret = sealSecret(body.webhookSecret);
    }

    const updated = await updateVoiceAccount(organizationId, id, patch);
    return { data: toVoiceSummary(updated) };
  },
);

export const DELETE = withApi(
  {
    permission: "integrations:manage",
    rateLimit: { name: "integrations.voice.delete", limit: 30, windowSec: 60 },
  },
  async ({ params, organizationId }) => {
    const id = params.id ?? "";
    await deleteVoiceAccount(organizationId, id);
    return { ok: true };
  },
);
