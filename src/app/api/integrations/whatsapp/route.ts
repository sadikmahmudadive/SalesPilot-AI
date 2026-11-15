/**
 * The workspace's connected WhatsApp business number (owner / admin).
 *
 * GET    -> 200 WhatsAppConnectionSummary (never the access token)
 * PUT    whatsappConnectionInputSchema -> 200 summary; 409 when another workspace owns the number;
 *        503 when ENCRYPTION_KEY is not configured
 * DELETE -> 204 (disconnects: removes the connection and frees the number)
 */
import { withApi } from "@/lib/api/handler";
import { whatsappConnectionInputSchema } from "@/schemas/whatsapp-connection";
import {
  disconnectWhatsApp,
  getWhatsAppConnection,
  saveWhatsAppConnection,
} from "@/services/whatsapp/connections";

export const dynamic = "force-dynamic";

export const GET = withApi(
  {
    permission: "integrations:manage",
    rateLimit: { name: "integrations.whatsapp.read", limit: 60, windowSec: 60 },
  },
  async ({ organizationId, uid }) => getWhatsAppConnection({ organizationId, uid }),
);

export const PUT = withApi(
  {
    permission: "integrations:manage",
    schema: whatsappConnectionInputSchema,
    rateLimit: { name: "integrations.whatsapp.save", limit: 20, windowSec: 60 },
  },
  async ({ organizationId, uid, body }) => saveWhatsAppConnection({ organizationId, uid }, body),
);

export const DELETE = withApi(
  {
    permission: "integrations:manage",
    rateLimit: { name: "integrations.whatsapp.delete", limit: 10, windowSec: 60 },
  },
  async ({ organizationId, uid }) => {
    await disconnectWhatsApp({ organizationId, uid });
    return new Response(null, { status: 204 });
  },
);
