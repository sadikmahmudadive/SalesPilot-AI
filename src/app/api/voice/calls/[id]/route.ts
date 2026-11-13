import { withApi } from "@/lib/api/handler";
import { NotFoundError } from "@/lib/errors";
import { getVoiceCall, updateVoiceCall } from "@/repositories/voice";
import { updateVoiceCallSchema } from "@/schemas/voice";

export const dynamic = "force-dynamic";

export const GET = withApi(
  { permission: "voice:read" },
  async ({ params, organizationId }) => {
    const id = params.id ?? "";
    const call = await getVoiceCall(organizationId, id);
    if (!call) throw new NotFoundError("Voice call not found");
    return { data: call };
  },
);

export const PATCH = withApi(
  {
    permission: "voice:write",
    schema: updateVoiceCallSchema,
    rateLimit: { name: "voice.calls.update", limit: 60, windowSec: 60 },
  },
  async ({ params, body, organizationId }) => {
    const id = params.id ?? "";
    const patch: Partial<{ outcome: typeof body.outcome; notes: string | null }> = {};
    if (body.outcome !== undefined) patch.outcome = body.outcome;
    if (body.notes !== undefined) patch.notes = body.notes;
    const updated = await updateVoiceCall(organizationId, id, patch);
    return { data: updated };
  },
);
