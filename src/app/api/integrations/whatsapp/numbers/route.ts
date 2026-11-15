/**
 * POST /api/integrations/whatsapp/numbers { accessToken } -> 200 { numbers } : the WhatsApp numbers
 * that token can connect (owner / admin). Nothing is stored and the token is never returned;
 * 400 when Meta does not accept the token.
 */
import { withApi } from "@/lib/api/handler";
import { whatsappNumbersInputSchema } from "@/schemas/whatsapp-connection";
import { discoverWhatsAppNumbers } from "@/services/whatsapp/discovery";

export const dynamic = "force-dynamic";

export const POST = withApi(
  {
    permission: "integrations:manage",
    schema: whatsappNumbersInputSchema,
    rateLimit: { name: "integrations.whatsapp.numbers", limit: 10, windowSec: 60 },
  },
  async ({ body }) => discoverWhatsAppNumbers(body.accessToken),
);
