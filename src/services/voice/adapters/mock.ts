import { timingSafeEqual } from "node:crypto";

import { unsealSecret } from "@/lib/security/secret-box";
import type {
  CallStatus,
  CallTranscriptEntry,
  VoiceAccount,
} from "@/schemas/voice";

import type {
  InitiateVoiceCallInput,
  InitiateVoiceCallOutput,
  VoiceProviderAdapter,
  VoiceWebhookEvent,
  VoiceWebhookRequest,
} from "../types";

export class MockVoiceAdapter implements VoiceProviderAdapter {
  readonly id = "mock" as const;

  async testConnection(_account: VoiceAccount): Promise<void> {
    void _account;
  }

  async initiateCall(
    _account: VoiceAccount,
    input: InitiateVoiceCallInput,
  ): Promise<InitiateVoiceCallOutput> {
    void _account;
    return {
      providerCallId: `mock_call_${input.callId}`,
      status: "ringing",
      raw: { mock: true, to: input.toPhoneE164 },
    };
  }

  async verifyWebhook(account: VoiceAccount, req: VoiceWebhookRequest): Promise<boolean> {
    if (!account.webhookSecret) return true;
    const expected = unsealSecret(account.webhookSecret);
    const provided = req.headers["x-voice-secret"] ?? "";
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(provided, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(req: VoiceWebhookRequest): VoiceWebhookEvent | null {
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return null;

    const kind = body.kind;
    const providerCallId =
      typeof body.providerCallId === "string" ? body.providerCallId : "";
    if (!providerCallId) return null;

    if (kind === "tool_calls" && Array.isArray(body.toolCalls)) {
      return {
        kind: "tool_calls",
        providerCallId,
        toolCalls: body.toolCalls
          .filter(
            (tc): tc is { id: string; name: string; arguments: string } =>
              Boolean(tc) &&
              typeof tc === "object" &&
              typeof (tc as { id?: unknown }).id === "string" &&
              typeof (tc as { name?: unknown }).name === "string",
          )
          .map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments:
              typeof tc.arguments === "string"
                ? tc.arguments
                : JSON.stringify(tc.arguments ?? {}),
          })),
        metadata:
          typeof body.metadata === "object" && body.metadata !== null
            ? (body.metadata as Record<string, string>)
            : undefined,
      };
    }

    const status = (typeof body.status === "string" ? body.status : "completed") as CallStatus;
    return {
      kind: "status_update",
      providerCallId,
      status,
      durationSeconds:
        typeof body.durationSeconds === "number" ? body.durationSeconds : undefined,
      recordingUrl:
        typeof body.recordingUrl === "string" ? body.recordingUrl : undefined,
      summary: typeof body.summary === "string" ? body.summary : undefined,
      transcript: Array.isArray(body.transcript)
        ? (body.transcript as CallTranscriptEntry[])
        : undefined,
      endedReason:
        typeof body.endedReason === "string" ? body.endedReason : undefined,
      raw: body,
    };
  }
}

export const mockVoiceAdapter = new MockVoiceAdapter();
