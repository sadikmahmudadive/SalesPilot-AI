import type {
  CallDirection,
  CallStatus,
  CallTranscriptEntry,
  VoiceAccount,
  VoiceProvider,
} from "@/schemas/voice";

export interface VoiceToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface InitiateVoiceCallInput {
  callId: string;
  toPhoneE164: string;
  customerName?: string | null;
  systemPrompt: string;
  firstMessage?: string;
  agentId?: string | null;
  webhookUrl: string;
  toolSpecs?: VoiceToolSpec[];
  metadata?: Record<string, string>;
}

export interface InitiateVoiceCallOutput {
  providerCallId: string;
  status: CallStatus;
  raw?: unknown;
}

export interface VoiceWebhookRequest {
  method: string;
  headers: Record<string, string | undefined>;
  url: string;
  rawBody: string;
  body: unknown;
}

export type VoiceWebhookEvent =
  | {
      kind: "status_update";
      providerCallId: string;
      status: CallStatus;
      direction?: CallDirection;
      fromPhone?: string;
      toPhone?: string;
      endedReason?: string | null;
      recordingUrl?: string | null;
      durationSeconds?: number;
      costMinor?: number | null;
      startedAt?: string | null;
      endedAt?: string | null;
      summary?: string | null;
      transcript?: CallTranscriptEntry[];
      metadata?: Record<string, string>;
      raw?: unknown;
    }
  | {
      kind: "tool_calls";
      providerCallId: string;
      toolCalls: Array<{ id: string; name: string; arguments: string }>;
      metadata?: Record<string, string>;
    }
  | {
      kind: "twilio_turn";
      providerCallId: string;
      speechResult?: string;
      fromPhone?: string;
      toPhone?: string;
      callStatus?: string;
      isInitialGather?: boolean;
    };

export interface VoiceProviderAdapter {
  readonly id: VoiceProvider;
  testConnection(account: VoiceAccount): Promise<void>;
  initiateCall(
    account: VoiceAccount,
    input: InitiateVoiceCallInput,
  ): Promise<InitiateVoiceCallOutput>;
  verifyWebhook(account: VoiceAccount, req: VoiceWebhookRequest): Promise<boolean>;
  parseWebhook(req: VoiceWebhookRequest): VoiceWebhookEvent | null;
}
