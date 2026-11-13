import { z } from "zod";

import { INTEGRATION_MODES, sealedSecretSchema } from "./integration";

export const VOICE_PROVIDERS = ["vapi", "twilio", "mock"] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];

export const CALL_DIRECTIONS = ["inbound", "outbound"] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

export const CALL_STATUSES = [
  "queued",
  "ringing",
  "in_progress",
  "completed",
  "failed",
  "busy",
  "no_answer",
  "canceled",
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const TERMINAL_CALL_STATUSES: ReadonlySet<CallStatus> = new Set([
  "completed",
  "failed",
  "busy",
  "no_answer",
  "canceled",
]);

export const CALL_OUTCOMES = [
  "sale_drafted",
  "order_confirmed",
  "follow_up",
  "not_interested",
  "escalated",
  "voicemail",
  "no_answer",
  "other",
  "unknown",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const callTranscriptEntrySchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  text: z.string(),
  timestamp: z.string().optional(),
});
export type CallTranscriptEntry = z.infer<typeof callTranscriptEntrySchema>;

export const voiceAccountSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  provider: z.enum(VOICE_PROVIDERS),
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
export type VoiceAccount = z.infer<typeof voiceAccountSchema>;

export const voiceAccountSummarySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  provider: z.enum(VOICE_PROVIDERS),
  label: z.string(),
  mode: z.enum(INTEGRATION_MODES),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  publicConfig: z.record(z.string(), z.unknown()),
  hasCredentials: z.boolean(),
  hasWebhookSecret: z.boolean(),
  webhookUrl: z.string(),
  lastTestedAt: z.string().nullable().optional(),
  lastTestResult: z.enum(["ok", "failed"]).nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
});
export type VoiceAccountSummary = z.infer<typeof voiceAccountSummarySchema>;

export const createVoiceAccountInputSchema = z.object({
  provider: z.enum(VOICE_PROVIDERS),
  label: z.string().trim().min(1).max(50),
  mode: z.enum(INTEGRATION_MODES),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  credentials: z.record(z.string(), z.string()).default({}),
  webhookSecret: z.string().trim().optional(),
  publicConfig: z.record(z.string(), z.unknown()).default({}),
});
export type CreateVoiceAccountInput = z.infer<typeof createVoiceAccountInputSchema>;

export const updateVoiceAccountInputSchema = z.object({
  label: z.string().trim().min(1).max(50).optional(),
  mode: z.enum(INTEGRATION_MODES).optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  credentials: z.record(z.string(), z.string()).optional(),
  webhookSecret: z.string().trim().optional(),
  publicConfig: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateVoiceAccountInput = z.infer<typeof updateVoiceAccountInputSchema>;

export const voiceCallSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  voiceAccountId: z.string(),
  provider: z.enum(VOICE_PROVIDERS),
  providerCallId: z.string().nullable(),
  direction: z.enum(CALL_DIRECTIONS),
  status: z.enum(CALL_STATUSES),
  outcome: z.enum(CALL_OUTCOMES),
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  phoneE164: z.string(),
  orderId: z.string().nullable(),
  agentId: z.string().nullable(),
  agentName: z.string().nullable(),
  purpose: z.string().nullable().optional(),
  durationSeconds: z.number().int().min(0),
  costMinor: z.number().int().min(0).nullable().optional(),
  currency: z.string().default("USD"),
  recordingUrl: z.string().nullable(),
  summary: z.string().nullable(),
  transcript: z.array(callTranscriptEntrySchema),
  notes: z.string().nullable().optional(),
  endedReason: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VoiceCall = z.infer<typeof voiceCallSchema>;

export const initiateCallInputSchema = z
  .object({
    phoneE164: z.string().trim().optional(),
    customerId: z.string().trim().min(1).optional(),
    orderId: z.string().trim().min(1).optional(),
    agentId: z.string().trim().min(1).optional(),
    voiceAccountId: z.string().trim().min(1).optional(),
    purpose: z.string().trim().max(200).optional(),
  })
  .refine(
    (v) => Boolean(v.phoneE164 || v.customerId || v.orderId),
    "Provide a phone number, customer, or order to call.",
  );
export type InitiateCallInput = z.infer<typeof initiateCallInputSchema>;

export const updateVoiceCallSchema = z.object({
  outcome: z.enum(CALL_OUTCOMES).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateVoiceCallInput = z.infer<typeof updateVoiceCallSchema>;

export function toVoiceSummary(account: VoiceAccount): VoiceAccountSummary {
  const toIso = (ts: unknown): string | null => {
    if (!ts) return null;
    if (typeof ts === "string") return ts;
    if (typeof (ts as { toDate?: () => Date }).toDate === "function") {
      return (ts as { toDate: () => Date }).toDate().toISOString();
    }
    return new Date(ts as string | number).toISOString();
  };

  return {
    id: account.id,
    organizationId: account.organizationId,
    provider: account.provider,
    label: account.label,
    mode: account.mode,
    enabled: account.enabled,
    isDefault: account.isDefault,
    publicConfig: account.publicConfig ?? {},
    hasCredentials: !!account.credentials,
    hasWebhookSecret: !!account.webhookSecret,
    webhookUrl: `/api/webhooks/voice/${account.provider}/${account.id}`,
    lastTestedAt: toIso(account.lastTestedAt),
    lastTestResult: account.lastTestResult ?? null,
    createdAt: toIso(account.createdAt),
    updatedAt: toIso(account.updatedAt),
  };
}
