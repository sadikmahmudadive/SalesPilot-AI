/**
 * Meta WhatsApp Cloud API Webhook Handler.
 *
 * GET  - Meta challenge verification.
 * POST - Inbound WhatsApp message and status update processing.
 */
import { getServerEnv } from "@/config/env";
import { verifyWhatsAppSignature } from "@/lib/whatsapp/signature";
import type { WhatsAppWebhookPayload } from "@/lib/whatsapp/types";
import { processWhatsAppWebhook } from "@/services/inbox/webhook-handler";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const env = getServerEnv();
  const configuredToken = env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token && configuredToken && token === configuredToken) {
    return new Response(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request): Promise<Response> {
  const env = getServerEnv();
  const appSecret = env.WHATSAPP_APP_SECRET;

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!appSecret || !verifyWhatsAppSignature(rawBody, signature, appSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Process asynchronously or await idempotent processor
  try {
    await processWhatsAppWebhook(payload);
  } catch {
    // Return 200 anyway so Meta doesn't retry repeatedly on non-fatal background errors
  }

  return Response.json({ status: "ok" });
}
