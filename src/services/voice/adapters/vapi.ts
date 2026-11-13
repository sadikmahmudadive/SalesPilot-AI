import { timingSafeEqual } from "node:crypto";

import { fetchOutboundJson } from "@/lib/api/outbound-http";
import { ValidationError } from "@/lib/errors";
import { unsealSecret } from "@/lib/security/secret-box";
import type { CallStatus, CallTranscriptEntry, VoiceAccount } from "@/schemas/voice";

import type {
  InitiateVoiceCallInput,
  InitiateVoiceCallOutput,
  VoiceProviderAdapter,
  VoiceWebhookEvent,
  VoiceWebhookRequest,
} from "../types";

const VAPI_API_BASE = "https://api.vapi.ai";

interface VapiCredentials {
  apiKey: string;
}

function getCredentials(account: VoiceAccount): VapiCredentials {
  const json = unsealSecret(account.credentials);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "";
  if (!apiKey) {
    throw new ValidationError(undefined, "Vapi integration requires an apiKey credential");
  }
  return { apiKey };
}

function mapVapiStatus(rawStatus: string | undefined, endedReason?: string | null): CallStatus {
  const s = (rawStatus ?? "").toLowerCase();
  if (s === "queued" || s === "scheduled") return "queued";
  if (s === "ringing") return "ringing";
  if (s === "in-progress" || s === "forwarding") return "in_progress";
  if (s === "ended") {
    const r = (endedReason ?? "").toLowerCase();
    if (r.includes("busy")) return "busy";
    if (r.includes("no-answer") || r.includes("did-not-answer")) return "no_answer";
    if (r.includes("cancel")) return "canceled";
    if (r.includes("error") || r.includes("failed")) return "failed";
    return "completed";
  }
  return "completed";
}

function parseVapiTranscript(msg: Record<string, unknown>): CallTranscriptEntry[] | undefined {
  const rawMessages = Array.isArray(msg.messages)
    ? msg.messages
    : Array.isArray((msg.artifact as Record<string, unknown> | undefined)?.messages)
      ? ((msg.artifact as Record<string, unknown>).messages as unknown[])
      : null;

  if (!rawMessages) {
    if (typeof msg.transcript === "string" && msg.transcript.trim()) {
      return [{ role: "assistant", text: msg.transcript.trim() }];
    }
    return undefined;
  }

  const entries: CallTranscriptEntry[] = [];
  for (const item of rawMessages) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    const rawRole = typeof m.role === "string" ? m.role.toLowerCase() : "";
    const text =
      typeof m.message === "string"
        ? m.message
        : typeof m.content === "string"
          ? m.content
          : "";
    if (!text.trim()) continue;
    const role: CallTranscriptEntry["role"] =
      rawRole === "user" || rawRole === "customer"
        ? "user"
        : rawRole === "system"
          ? "system"
          : "assistant";
    entries.push({ role, text: text.trim() });
  }
  return entries.length > 0 ? entries : undefined;
}

export class VapiVoiceAdapter implements VoiceProviderAdapter {
  readonly id = "vapi" as const;

  async testConnection(account: VoiceAccount): Promise<void> {
    const { apiKey } = getCredentials(account);
    await fetchOutboundJson(`${VAPI_API_BASE}/phone-number?limit=1`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: 10_000,
    });
  }

  async initiateCall(
    account: VoiceAccount,
    input: InitiateVoiceCallInput,
  ): Promise<InitiateVoiceCallOutput> {
    const { apiKey } = getCredentials(account);
    const phoneNumberId =
      typeof account.publicConfig.phoneNumberId === "string"
        ? account.publicConfig.phoneNumberId.trim()
        : "";
    const assistantId =
      typeof account.publicConfig.assistantId === "string"
        ? account.publicConfig.assistantId.trim()
        : "";

    if (!phoneNumberId) {
      throw new ValidationError(
        undefined,
        "Vapi integration requires a phoneNumberId in configuration",
      );
    }

    const secret = account.webhookSecret ? unsealSecret(account.webhookSecret) : undefined;

    const toolsPayload = (input.toolSpecs ?? []).map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
      server: {
        url: input.webhookUrl,
        ...(secret ? { secret } : {}),
      },
    }));

    const payload: Record<string, unknown> = {
      phoneNumberId,
      customer: {
        number: input.toPhoneE164,
        ...(input.customerName ? { name: input.customerName } : {}),
      },
      metadata: {
        salesPilotCallId: input.callId,
        ...(input.agentId ? { agentId: input.agentId } : {}),
        ...(input.metadata ?? {}),
      },
    };

    if (assistantId) {
      payload.assistantId = assistantId;
      payload.assistantOverrides = {
        serverUrl: input.webhookUrl,
        ...(secret ? { serverUrlSecret: secret } : {}),
        ...(input.firstMessage ? { firstMessage: input.firstMessage } : {}),
      };
    } else {
      payload.assistant = {
        name: "SalesPilot Voice Agent",
        firstMessage: input.firstMessage ?? "Hello! How can I help you today?",
        model: {
          provider: "openai",
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: input.systemPrompt }],
          ...(toolsPayload.length > 0 ? { tools: toolsPayload } : {}),
        },
        serverUrl: input.webhookUrl,
        ...(secret ? { serverUrlSecret: secret } : {}),
      };
    }

    const res = await fetchOutboundJson<Record<string, unknown>>(`${VAPI_API_BASE}/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      timeoutMs: 15_000,
    });

    const providerCallId = typeof res.id === "string" ? res.id : "";
    if (!providerCallId) {
      throw new Error("Vapi did not return a call id");
    }

    return {
      providerCallId,
      status: mapVapiStatus(typeof res.status === "string" ? res.status : "queued"),
      raw: res,
    };
  }

  async verifyWebhook(account: VoiceAccount, req: VoiceWebhookRequest): Promise<boolean> {
    if (!account.webhookSecret) return true;
    const expected = unsealSecret(account.webhookSecret);
    const provided = req.headers["x-vapi-secret"] ?? "";
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(provided, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(req: VoiceWebhookRequest): VoiceWebhookEvent | null {
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return null;

    const msg =
      typeof body.message === "object" && body.message !== null
        ? (body.message as Record<string, unknown>)
        : body;

    const type = typeof msg.type === "string" ? msg.type : "";
    const call =
      typeof msg.call === "object" && msg.call !== null
        ? (msg.call as Record<string, unknown>)
        : undefined;
    const providerCallId =
      typeof call?.id === "string"
        ? call.id
        : typeof msg.callId === "string"
          ? msg.callId
          : "";

    if (!providerCallId) return null;

    const metadata =
      typeof call?.metadata === "object" && call.metadata !== null
        ? (call.metadata as Record<string, string>)
        : undefined;

    if (type === "tool-calls") {
      const list = Array.isArray(msg.toolCallList)
        ? msg.toolCallList
        : Array.isArray(msg.toolCalls)
          ? msg.toolCalls
          : [];
      const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const tc = item as Record<string, unknown>;
        const id = typeof tc.id === "string" ? tc.id : "";
        const fn =
          typeof tc.function === "object" && tc.function !== null
            ? (tc.function as Record<string, unknown>)
            : tc;
        const name = typeof fn.name === "string" ? fn.name : "";
        if (!id || !name) continue;
        const rawArgs = fn.arguments;
        const args = typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs ?? {});
        toolCalls.push({ id, name, arguments: args });
      }
      return { kind: "tool_calls", providerCallId, toolCalls, metadata };
    }

    if (type === "status-update" || type === "end-of-call-report") {
      const endedReason =
        typeof msg.endedReason === "string"
          ? msg.endedReason
          : typeof call?.endedReason === "string"
            ? call.endedReason
            : null;
      const rawStatus =
        type === "end-of-call-report"
          ? "ended"
          : typeof msg.status === "string"
            ? msg.status
            : typeof call?.status === "string"
              ? call.status
              : "in-progress";

      const durationSeconds =
        typeof msg.durationSeconds === "number"
          ? Math.max(0, Math.round(msg.durationSeconds))
          : undefined;
      const recordingUrl =
        typeof msg.recordingUrl === "string"
          ? msg.recordingUrl
          : typeof (msg.artifact as Record<string, unknown> | undefined)?.recordingUrl === "string"
            ? ((msg.artifact as Record<string, unknown>).recordingUrl as string)
            : undefined;
      const summary =
        typeof msg.summary === "string"
          ? msg.summary
          : typeof (msg.analysis as Record<string, unknown> | undefined)?.summary === "string"
            ? ((msg.analysis as Record<string, unknown>).summary as string)
            : undefined;

      const callType = typeof call?.type === "string" ? call.type : "";
      const direction = callType.includes("inbound")
        ? "inbound"
        : callType.includes("outbound")
          ? "outbound"
          : undefined;

      return {
        kind: "status_update",
        providerCallId,
        status: mapVapiStatus(rawStatus, endedReason),
        direction,
        endedReason,
        recordingUrl: recordingUrl ?? null,
        durationSeconds,
        summary: summary ?? null,
        transcript: parseVapiTranscript(msg),
        startedAt: typeof call?.startedAt === "string" ? call.startedAt : undefined,
        endedAt: typeof call?.endedAt === "string" ? call.endedAt : undefined,
        metadata,
        raw: body,
      };
    }

    return null;
  }
}

export const vapiVoiceAdapter = new VapiVoiceAdapter();
