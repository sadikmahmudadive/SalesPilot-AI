import { getServerEnv, isConfigured } from "@/config/env";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = withApi(
  {
    permission: "integrations:manage",
    rateLimit: { name: "integrations.status", limit: 60, windowSec: 60 },
  },
  async ({ organizationId }) => {
    return {
      // This workspace's id, so an admin can set WHATSAPP_ORGANIZATION_ID to it.
      workspaceId: organizationId,
      status: {
        whatsapp: isConfigured("whatsapp"),
        // WhatsApp messages are delivered to THIS workspace only when it is the configured owner.
        whatsappLinkedHere: getServerEnv().WHATSAPP_ORGANIZATION_ID === organizationId,
        openai: isConfigured("openai"),
        cloudinary: isConfigured("cloudinary"),
        n8n: isConfigured("n8n"),
        twilioEnv: isConfigured("twilio"),
        sslcommerzEnv: isConfigured("sslcommerz"),
      },
    };
  },
);
