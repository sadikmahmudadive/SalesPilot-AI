import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { normalizePhone } from "@/lib/phone";
import { agentRepo } from "@/repositories/agents";
import { customerRepo } from "@/repositories/customers";
import {
  createVoiceCall,
  getVoiceAccountByIdUnsafe,
  getVoiceCall,
  getVoiceCallByProviderId,
  updateVoiceCall,
} from "@/repositories/voice";
import type { Agent } from "@/schemas/agent";
import {
  TERMINAL_CALL_STATUSES,
  type CallOutcome,
  type VoiceCall,
  type VoiceProvider,
} from "@/schemas/voice";
import { executeTool } from "@/services/agents/tools/registry";
import type { ToolContext } from "@/services/agents/tools/types";

import { buildTwimlGather, buildTwimlHangup } from "./adapters/twilio";
import { getVoiceAdapter } from "./registry";
import type { VoiceWebhookRequest } from "./types";

const MAX_WEBHOOK_BYTES = 256 * 1024;

export interface HandleVoiceWebhookResult {
  status: number;
  contentType: "application/json" | "text/xml";
  body: unknown;
}

async function resolveAgentForCall(orgId: string, call: VoiceCall | null, metaAgentId?: string): Promise<Agent | null> {
  const id = call?.agentId ?? metaAgentId;
  if (id) {
    const found = await agentRepo.get(orgId, id);
    if (found) return found;
  }
  const snap = await adminDb()
    .collection("agents")
    .where("organizationId", "==", orgId)
    .where("status", "==", "active")
    .limit(10)
    .get();
  const agents = snap.docs.map((d) => ({ ...(d.data() as Agent), id: d.id }));
  return (
    agents.find((a) => a.channels?.includes("voice")) ??
    agents.find((a) => a.role === "voice_sales") ??
    agents[0] ??
    null
  );
}

export async function handleVoiceWebhook(
  provider: VoiceProvider,
  accountId: string,
  req: VoiceWebhookRequest,
): Promise<HandleVoiceWebhookResult> {
  if (Buffer.byteLength(req.rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
    throw new ValidationError(undefined, "Voice webhook payload exceeds maximum size");
  }

  const account = await getVoiceAccountByIdUnsafe(accountId);
  if (!account || account.provider !== provider || !account.enabled) {
    throw new NotFoundError("Voice account not found or disabled");
  }

  const adapter = getVoiceAdapter(provider);
  const valid = await adapter.verifyWebhook(account, req);
  if (!valid) {
    throw new ForbiddenError("Invalid voice webhook signature");
  }

  const event = adapter.parseWebhook(req);
  if (!event) {
    return { status: 200, contentType: "application/json", body: { ok: true, ignored: true } };
  }

  const orgId = account.organizationId;

  // 1. Vapi real-time tool-calls
  if (event.kind === "tool_calls") {
    const salesPilotCallId = event.metadata?.salesPilotCallId;
    const call =
      (salesPilotCallId ? await getVoiceCall(orgId, salesPilotCallId) : null) ??
      (await getVoiceCallByProviderId(orgId, event.providerCallId));

    const agent = await resolveAgentForCall(orgId, call, event.metadata?.agentId);
    if (!agent) {
      return {
        status: 200,
        contentType: "application/json",
        body: {
          results: event.toolCalls.map((tc) => ({
            toolCallId: tc.id,
            result: JSON.stringify({ ok: false, message: "No active voice agent configured." }),
          })),
        },
      };
    }

    let derivedOutcome: CallOutcome | undefined;
    let derivedOrderId: string | undefined;

    const toolCtx: ToolContext = {
      organizationId: orgId,
      actorUid: "voice_webhook",
      agent,
      channel: "voice",
      sessionId: call?.id ?? event.providerCallId,
      contactPhoneE164: call?.phoneE164,
      escalateSession: async () => {
        derivedOutcome = "escalated";
      },
    };

    const results: Array<{ toolCallId: string; result: string }> = [];
    for (const tc of event.toolCalls) {
      const outcome = await executeTool(toolCtx, tc.name, tc.arguments);
      if (outcome.ok && tc.name === "create_draft_order") {
        derivedOutcome = "sale_drafted";
        const data = outcome.data as Record<string, unknown> | undefined;
        if (typeof data?.orderId === "string") derivedOrderId = data.orderId;
      } else if (outcome.ok && tc.name === "confirm_order") {
        derivedOutcome = "order_confirmed";
        const data = outcome.data as Record<string, unknown> | undefined;
        if (typeof data?.orderId === "string") derivedOrderId = data.orderId;
      }
      results.push({
        toolCallId: tc.id,
        result: JSON.stringify(outcome),
      });
    }

    if (call && (derivedOutcome || derivedOrderId)) {
      await updateVoiceCall(orgId, call.id, {
        ...(derivedOutcome ? { outcome: derivedOutcome } : {}),
        ...(derivedOrderId ? { orderId: derivedOrderId } : {}),
      });
    }

    return {
      status: 200,
      contentType: "application/json",
      body: { results },
    };
  }

  // 2. Twilio interactive TwiML speech loop
  if (event.kind === "twilio_turn") {
    let call = await getVoiceCallByProviderId(orgId, event.providerCallId);
    const phoneE164 = normalizePhone(event.fromPhone ?? "") ?? event.fromPhone ?? "unknown";

    if (!call) {
      const agent = await resolveAgentForCall(orgId, null);
      call = await createVoiceCall({
        organizationId: orgId,
        voiceAccountId: account.id,
        provider,
        providerCallId: event.providerCallId,
        direction: "inbound",
        status: "in_progress",
        outcome: "unknown",
        customerId: null,
        customerName: null,
        phoneE164,
        orderId: null,
        agentId: agent?.id ?? null,
        agentName: agent?.name ?? null,
        durationSeconds: 0,
        currency: "USD",
        recordingUrl: null,
        summary: null,
        transcript: [],
        endedReason: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
      });
    }

    if (event.isInitialGather || !event.speechResult) {
      const greeting = "Hello! Thank you for calling. How can I assist you today?";
      const transcript = [...call.transcript, { role: "assistant" as const, text: greeting }];
      await updateVoiceCall(orgId, call.id, { status: "in_progress", transcript });
      return {
        status: 200,
        contentType: "text/xml",
        body: buildTwimlGather(greeting, req.url),
      };
    }

    const userText = event.speechResult.trim();
    const shouldEnd = /\b(bye|goodbye|thank you|thanks|stop)\b/i.test(userText);
    const reply = shouldEnd
      ? "Thank you for calling! Have a great day. Goodbye."
      : "Got it. Let me note that down for you. Is there anything else you need help with?";

    const transcript = [
      ...call.transcript,
      { role: "user" as const, text: userText },
      { role: "assistant" as const, text: reply },
    ];
    await updateVoiceCall(orgId, call.id, {
      status: shouldEnd ? "completed" : "in_progress",
      transcript,
      ...(shouldEnd ? { endedAt: new Date().toISOString() } : {}),
    });

    return {
      status: 200,
      contentType: "text/xml",
      body: shouldEnd ? buildTwimlHangup(reply) : buildTwimlGather(reply, req.url),
    };
  }

  // 3. Status update / end-of-call report
  const metaCallId = event.metadata?.salesPilotCallId;
  let call =
    (metaCallId ? await getVoiceCall(orgId, metaCallId) : null) ??
    (await getVoiceCallByProviderId(orgId, event.providerCallId));

  if (!call) {
    const phone = normalizePhone(event.fromPhone ?? "") ?? event.fromPhone ?? "unknown";
    call = await createVoiceCall({
      organizationId: orgId,
      voiceAccountId: account.id,
      provider,
      providerCallId: event.providerCallId,
      direction: event.direction ?? "inbound",
      status: event.status,
      outcome: "unknown",
      customerId: null,
      customerName: null,
      phoneE164: phone,
      orderId: null,
      agentId: event.metadata?.agentId ?? null,
      agentName: null,
      durationSeconds: event.durationSeconds ?? 0,
      currency: "USD",
      recordingUrl: event.recordingUrl ?? null,
      summary: event.summary ?? null,
      transcript: event.transcript ?? [],
      endedReason: event.endedReason ?? null,
      startedAt: event.startedAt ?? new Date().toISOString(),
      endedAt: event.endedAt ?? null,
    });
  } else {
    let inferredOutcome = call.outcome;
    if (inferredOutcome === "unknown") {
      if (event.status === "no_answer" || event.status === "busy") {
        inferredOutcome = "no_answer";
      }
    }

    call = await updateVoiceCall(orgId, call.id, {
      providerCallId: event.providerCallId,
      status: event.status,
      outcome: inferredOutcome,
      ...(event.durationSeconds !== undefined ? { durationSeconds: event.durationSeconds } : {}),
      ...(event.recordingUrl ? { recordingUrl: event.recordingUrl } : {}),
      ...(event.summary ? { summary: event.summary } : {}),
      ...(event.transcript && event.transcript.length > 0 ? { transcript: event.transcript } : {}),
      ...(event.endedReason !== undefined ? { endedReason: event.endedReason } : {}),
      ...(event.startedAt ? { startedAt: event.startedAt } : {}),
      ...(event.endedAt
        ? { endedAt: event.endedAt }
        : TERMINAL_CALL_STATUSES.has(event.status) && !call.endedAt
          ? { endedAt: new Date().toISOString() }
          : {}),
    });
  }

  // Update customer.lastContactedAt on terminal call completion
  if (call.customerId && TERMINAL_CALL_STATUSES.has(event.status)) {
    try {
      await customerRepo.docRef(call.customerId).update({
        lastContactedAt: Timestamp.now(),
      });
    } catch (err) {
      logger.warn("Failed to update customer lastContactedAt after voice call", {
        customerId: call.customerId,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  return { status: 200, contentType: "application/json", body: { ok: true } };
}
