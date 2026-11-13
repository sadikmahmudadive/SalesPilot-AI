import { Timestamp } from "firebase-admin/firestore";

import { withApi } from "@/lib/api/handler";
import { NotFoundError } from "@/lib/errors";
import { getVoiceAccount, updateVoiceAccount } from "@/repositories/voice";
import { getVoiceAdapter } from "@/services/voice/registry";

export const dynamic = "force-dynamic";

export const POST = withApi(
  {
    permission: "integrations:manage",
    rateLimit: { name: "integrations.voice.test", limit: 20, windowSec: 60 },
  },
  async ({ params, organizationId }) => {
    const id = params.id ?? "";
    const account = await getVoiceAccount(organizationId, id);
    if (!account) throw new NotFoundError("Voice account not found");

    const adapter = getVoiceAdapter(account.provider);
    try {
      await adapter.testConnection(account);
      await updateVoiceAccount(organizationId, id, {
        lastTestedAt: Timestamp.now(),
        lastTestResult: "ok",
      });
      return { ok: true };
    } catch (err) {
      await updateVoiceAccount(organizationId, id, {
        lastTestedAt: Timestamp.now(),
        lastTestResult: "failed",
      });
      throw err;
    }
  },
);
