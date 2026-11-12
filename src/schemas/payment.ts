import { z } from "zod";

import { GATEWAY_PROVIDERS } from "./integration";

export const PAYMENT_ATTEMPT_STATES = [
  "created",
  "redirected",
  "paid",
  "failed",
  "cancelled",
  "expired",
] as const;
export type PaymentAttemptState = (typeof PAYMENT_ATTEMPT_STATES)[number];

export const paymentAttemptSchema = z.object({
  tranId: z.string(), // doc ID (128-bit random base32)
  organizationId: z.string(),
  orderId: z.string(),
  gatewayAccountId: z.string(),
  gateway: z.enum(GATEWAY_PROVIDERS),
  expectedAmountMinor: z.number().int().min(0),
  currency: z.literal("BDT"),
  state: z.enum(PAYMENT_ATTEMPT_STATES),
  gatewayRef: z.string().optional(),
  verifiedAt: z.custom<unknown>().optional(),
  failureReason: z.string().optional(),
  riskFlag: z.boolean().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.custom<unknown>(),
  updatedAt: z.custom<unknown>(),
});
export type PaymentAttempt = z.infer<typeof paymentAttemptSchema>;

export const paymentLinkSchema = z.object({
  tokenHash: z.string(), // SHA-256 hex string (doc ID)
  organizationId: z.string(),
  orderId: z.string(),
  expiresAt: z.custom<unknown>(),
  createdAt: z.custom<unknown>(),
  revokedAt: z.custom<unknown>().optional(),
});
export type PaymentLink = z.infer<typeof paymentLinkSchema>;

export const webhookEventSchema = z.object({
  id: z.string(), // ${provider}_${eventKey}
  provider: z.string(),
  eventKey: z.string(),
  receivedAt: z.custom<unknown>(),
});
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

/** Public representation for customer checkout page (scrubbed of private address & phone) */
export const publicPaymentViewSchema = z.object({
  orderNumber: z.string(),
  organizationName: z.string(),
  lines: z.array(
    z.object({
      name: z.string(),
      variantName: z.string().optional(),
      quantity: z.number().int().min(1),
      unitPriceMinor: z.number().int().min(0),
      totalMinor: z.number().int().min(0),
    }),
  ),
  deliveryChargeMinor: z.number().int().min(0),
  discountMinor: z.number().int().min(0),
  totalMinor: z.number().int().min(0),
  currency: z.literal("BDT"),
  status: z.enum(["awaiting_payment", "paid", "expired", "cancelled", "already_processed"]),
  availableGateways: z.array(
    z.object({
      id: z.string(),
      provider: z.enum(GATEWAY_PROVIDERS),
      label: z.string(),
      isDefault: z.boolean(),
    }),
  ),
  expiresAt: z.string(),
});
export type PublicPaymentView = z.infer<typeof publicPaymentViewSchema>;
