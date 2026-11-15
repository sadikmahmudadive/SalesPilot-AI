import { isConfigured } from "@/config/env";
import { withApi } from "@/lib/api/handler";
import { whatsappClientFor } from "@/services/whatsapp/connections";

export const dynamic = "force-dynamic";

export const GET = withApi(
  {
    permission: "integrations:manage",
    rateLimit: { name: "integrations.status", limit: 60, windowSec: 60 },
  },
  async ({ organizationId }) => {
    return {
      status: {
        // This workspace has a number to send from: its own enabled connection, or the env
        // single-number setup naming this workspace.
        whatsapp: (await whatsappClientFor(organizationId)) !== null,
        openai: isConfigured("openai"),
        cloudinary: isConfigured("cloudinary"),
        n8n: isConfigured("n8n"),
        twilioEnv: isConfigured("twilio"),
        sslcommerzEnv: isConfigured("sslcommerz"),
      },
    };
  },
);
