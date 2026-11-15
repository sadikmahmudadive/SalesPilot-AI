/**
 * POST /api/integrations/whatsapp/test -> 200 summary with `lastTestResult` ("ok" with the display
 * number and verified name from Meta, or "failed"). 404 when no number is connected.
 */
import { withApi } from "@/lib/api/handler";
import { testWhatsAppConnection } from "@/services/whatsapp/connections";

export const dynamic = "force-dynamic";

export const POST = withApi(
  {
    permission: "integrations:manage",
    rateLimit: { name: "integrations.whatsapp.test", limit: 10, windowSec: 60 },
  },
  async ({ organizationId, uid }) => testWhatsAppConnection({ organizationId, uid }),
);
