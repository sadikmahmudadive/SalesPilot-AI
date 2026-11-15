import "server-only";

import { getServerEnv } from "@/config/env";
import { AppError } from "@/lib/errors";

export class WhatsAppApiError extends AppError {
  readonly code = "WHATSAPP_API_ERROR";
  readonly status: number;

  constructor(message = "WhatsApp API request failed", status = 502) {
    super(message);
    this.name = "WhatsAppApiError";
    this.status = status;
  }
}

export interface WhatsAppClientOptions {
  accessToken?: string;
  phoneNumberId?: string;
  apiVersion?: string;
  fetchFn?: typeof fetch;
}

export interface WhatsAppClient {
  sendTextMessage(to: string, body: string): Promise<{ messageId: string }>;
  markMessageAsRead(messageId: string): Promise<boolean>;
}

export function createWhatsAppClient(options: WhatsAppClientOptions = {}): WhatsAppClient {
  const env =
    options.accessToken && options.phoneNumberId && options.apiVersion
      ? ({} as Record<string, string | undefined>)
      : getServerEnv();

  const accessToken = options.accessToken ?? env.WHATSAPP_ACCESS_TOKEN ?? "";
  const phoneNumberId = options.phoneNumberId ?? env.WHATSAPP_PHONE_NUMBER_ID ?? "";
  const apiVersion = options.apiVersion ?? env.META_GRAPH_API_VERSION ?? "v21.0";
  const fetchFn = options.fetchFn ?? fetch;

  async function postGraphApi<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}${endpoint}`;
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      const err = (data.error as { message?: string; code?: number } | undefined) ?? {};
      const msg = err.message ? `WhatsApp API error: ${err.message}` : "WhatsApp API request failed";
      throw new WhatsAppApiError(msg, res.status >= 500 ? 502 : res.status);
    }

    return data as T;
  }

  return {
    async sendTextMessage(to: string, body: string): Promise<{ messageId: string }> {
      // Normalize recipient to digits only as required by Meta (no leading +)
      const recipient = to.replace(/\D/g, "");

      const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: { body },
      };

      const res = await postGraphApi<{ messages?: Array<{ id: string }> }>("/messages", payload);
      const messageId = res.messages?.[0]?.id ?? "";
      return { messageId };
    },

    async markMessageAsRead(messageId: string): Promise<boolean> {
      const payload = {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      };

      const res = await postGraphApi<{ success?: boolean }>("/messages", payload);
      return Boolean(res.success);
    },
  };
}
