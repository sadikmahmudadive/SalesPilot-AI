/**
 * A workspace's connected WhatsApp business number. Pure (shared by the API and the UI).
 *
 * The access token is write-only: it is accepted in the input, stored sealed in the server-only
 * doc, and never part of the summary returned to the browser.
 */
import { z } from "zod";

import type { SealedSecret } from "@/schemas/integration";

/** Meta ids are numeric strings; the bounds just keep junk out. */
const metaId = (label: string) =>
  z
    .string({ error: `Enter the ${label}` })
    .trim()
    .regex(/^\d{5,30}$/, { error: `The ${label} is a number from your Meta app` });

export const whatsappConnectionInputSchema = z.object({
  phoneNumberId: metaId("Phone Number ID"),
  businessAccountId: metaId("WhatsApp Business Account ID"),
  /** Required on the first save; omitted or blank keeps the saved token. */
  accessToken: z
    .string()
    .trim()
    .transform((v) => (v === "" ? undefined : v))
    .pipe(
      z
        .string()
        .min(20, { error: "That access token looks too short" })
        .max(1000, { error: "That access token is too long" })
        .optional(),
    )
    .optional(),
  enabled: z.boolean().default(true),
});
export type WhatsAppConnectionInput = z.output<typeof whatsappConnectionInputSchema>;

export type ConnectionTestResult = "ok" | "failed";

/** `whatsappConnections/{orgId}` as read by the server (timestamps as ISO strings). */
export interface WhatsAppConnectionDoc {
  organizationId: string;
  phoneNumberId: string;
  businessAccountId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  credentials: SealedSecret;
  enabled: boolean;
  lastTestedAt: string | null;
  lastTestResult: ConnectionTestResult | null;
  createdAt: string;
  updatedAt: string;
}

export const WHATSAPP_WEBHOOK_PATH = "/api/webhooks/whatsapp" as const;

export interface WhatsAppConnectionSummary {
  connected: boolean;
  phoneNumberId: string | null;
  businessAccountId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  enabled: boolean;
  hasAccessToken: boolean;
  lastTestedAt: string | null;
  lastTestResult: ConnectionTestResult | null;
  webhookUrl: typeof WHATSAPP_WEBHOOK_PATH;
  /** The platform's Meta app webhook (app secret + verify token) is configured in env. */
  platformWebhookReady: boolean;
}

export function toConnectionSummary(
  doc: WhatsAppConnectionDoc | null,
  platformWebhookReady: boolean,
): WhatsAppConnectionSummary {
  return {
    connected: doc !== null,
    phoneNumberId: doc?.phoneNumberId ?? null,
    businessAccountId: doc?.businessAccountId ?? null,
    displayPhoneNumber: doc?.displayPhoneNumber ?? null,
    verifiedName: doc?.verifiedName ?? null,
    enabled: doc?.enabled ?? false,
    hasAccessToken: Boolean(doc?.credentials),
    lastTestedAt: doc?.lastTestedAt ?? null,
    lastTestResult: doc?.lastTestResult ?? null,
    webhookUrl: WHATSAPP_WEBHOOK_PATH,
    platformWebhookReady,
  };
}
