import { Timestamp } from "firebase-admin/firestore";

import { withApi } from "@/lib/api/handler";
import { NotFoundError } from "@/lib/errors";
import {
  getCourierAccount,
  updateCourierAccount,
} from "@/repositories/couriers";
import { getCourierAdapter } from "@/services/couriers/registry";

export const dynamic = "force-dynamic";

export const POST = withApi(
  {
    permission: "integrations:manage",
    rateLimit: { name: "integrations.couriers.test", limit: 20, windowSec: 60 },
  },
  async ({ params, organizationId }) => {
    const id = params.id ?? "";
    const account = await getCourierAccount(organizationId, id);
    if (!account) throw new NotFoundError("Courier account not found");

    const adapter = getCourierAdapter(account.provider);
    try {
      await adapter.testConnection(account);
      await updateCourierAccount(organizationId, id, {
        lastTestedAt: Timestamp.now(),
        lastTestResult: "ok",
      });
      return { ok: true, message: "Connection test succeeded" };
    } catch (err) {
      await updateCourierAccount(organizationId, id, {
        lastTestedAt: Timestamp.now(),
        lastTestResult: "failed",
      });
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Connection test failed",
      };
    }
  },
);
