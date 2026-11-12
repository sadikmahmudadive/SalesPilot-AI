import { z } from "zod";

export const GATEWAY_PROVIDERS = ["sslcommerz", "aamarpay", "uddoktapay", "mock"] as const;
export type GatewayProvider = (typeof GATEWAY_PROVIDERS)[number];

export const INTEGRATION_MODES = ["sandbox", "live", "mock"] as const;
export type IntegrationMode = (typeof INTEGRATION_MODES)[number];

export const sealedSecretSchema = z.object({
  v: z.literal(1),
  iv: z.string(),
  tag: z.string(),
  data: z.string(),
});
export type SealedSecret = z.infer<typeof sealedSecretSchema>;

export const gatewayAccountSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  provider: z.enum(GATEWAY_PROVIDERS),
  label: z.string().trim().min(1).max(50),
  mode: z.enum(INTEGRATION_MODES),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  credentials: sealedSecretSchema,
  webhookSecret: sealedSecretSchema.optional(),
  publicConfig: z.record(z.string(), z.unknown()),
  lastTestedAt: z.custom<unknown>().optional(),
  lastTestResult: z.enum(["ok", "failed"]).optional(),
  createdAt: z.custom<unknown>(),
  updatedAt: z.custom<unknown>(),
});
export type GatewayAccount = z.infer<typeof gatewayAccountSchema>;

/** Public representation returned to clients; credentials are never exposed. */
export const gatewayAccountSummarySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  provider: z.enum(GATEWAY_PROVIDERS),
  label: z.string(),
  mode: z.enum(INTEGRATION_MODES),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  publicConfig: z.record(z.string(), z.unknown()),
  hasCredentials: z.boolean(),
  lastTestedAt: z.string().nullable().optional(),
  lastTestResult: z.enum(["ok", "failed"]).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GatewayAccountSummary = z.infer<typeof gatewayAccountSummarySchema>;

export const gatewayAccountInputSchema = z.object({
  provider: z.enum(GATEWAY_PROVIDERS),
  label: z.string().trim().min(1, "Label is required").max(50),
  mode: z.enum(INTEGRATION_MODES),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  credentials: z.record(z.string(), z.string()).optional(),
  publicConfig: z.record(z.string(), z.unknown()).default({}),
});
export type GatewayAccountInput = z.infer<typeof gatewayAccountInputSchema>;

export const gatewayAccountPatchSchema = gatewayAccountInputSchema.partial();
export type GatewayAccountPatch = z.infer<typeof gatewayAccountPatchSchema>;
