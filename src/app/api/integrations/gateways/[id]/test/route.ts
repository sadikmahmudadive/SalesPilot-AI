import { Timestamp } from "firebase-admin/firestore";

import { withApi } from "@/lib/api/handler";
import { NotFoundError } from "@/lib/errors";
import {
  getGatewayAccount,
  updateGatewayAccount,
} from "@/repositories/integrations";
import { getPaymentGateway } from "@/services/payments/gateways/registry";

export const dynamic = "force-dynamic";

export const POST = withApi(
  {
    permission: "integrations:manage",
    rateLimit: { name: "integrations.gateways.test", limit: 20, windowSec: 60 },
  },
  async ({ params, organizationId }) => {
    const id = params.id ?? "";
    const account = await getGatewayAccount(organizationId, id);
    if (!account) throw new NotFoundError("Gateway account not found");

    const gateway = getPaymentGateway(account.provider);
    try {
      await gateway.testConnection(account);
      await updateGatewayAccount(organizationId, id, {
        lastTestedAt: Timestamp.now(),
        lastTestResult: "ok",
      });
      return { ok: true, message: "Connection test succeeded" };
    } catch (err) {
      await updateGatewayAccount(organizationId, id, {
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
