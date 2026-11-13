import { isConfigured } from "@/config/env";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = withApi(
  {
    permission: "integrations:manage",
    rateLimit: { name: "integrations.status", limit: 60, windowSec: 60 },
  },
  async () => {
    return {
      status: {
        whatsapp: isConfigured("whatsapp"),
        openai: isConfigured("openai"),
        cloudinary: isConfigured("cloudinary"),
        n8n: isConfigured("n8n"),
        twilioEnv: isConfigured("twilio"),
        sslcommerzEnv: isConfigured("sslcommerz"),
      },
    };
  },
);
