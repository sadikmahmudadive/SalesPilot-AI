import "server-only";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { assertOrgCtx, type OrgCtx } from "@/lib/org-context";
import { normalizePhone } from "@/lib/phone";
import { writeAudit } from "@/lib/security/audit";
import { agentRepo } from "@/repositories/agents";
import { customerRepo } from "@/repositories/customers";
import { orderRepo } from "@/repositories/orders";
import {
  createVoiceCall,
  getDefaultVoiceAccount,
  getVoiceAccount,
  updateVoiceCall,
} from "@/repositories/voice";
import type { Agent } from "@/schemas/agent";
import type { Customer } from "@/schemas/customer";
import { initiateCallInputSchema, type InitiateCallInput, type VoiceCall } from "@/schemas/voice";
import { buildSystemPrompt } from "@/services/agents/prompt";
import { toolSpecsFor } from "@/services/agents/tools/registry";

import { getVoiceAdapter } from "./registry";

async function findCustomerByPhone(orgId: string, phoneE164: string): Promise<Customer | null> {
  const snap = await adminDb()
    .collection("customers")
    .where("organizationId", "==", orgId)
    .where("phoneE164", "==", phoneE164)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return doc ? ({ ...(doc.data() as Customer), id: doc.id }) : null;
}

async function resolveVoiceAgent(orgId: string, agentId?: string): Promise<Agent | null> {
  if (agentId) {
    const agent = await agentRepo.get(orgId, agentId);
    if (!agent) throw new NotFoundError("AI agent not found");
    return agent;
  }

  const snap = await adminDb()
    .collection("agents")
    .where("organizationId", "==", orgId)
    .where("status", "==", "active")
    .limit(20)
    .get();

  const agents = snap.docs.map((d) => ({ ...(d.data() as Agent), id: d.id }));
  return (
    agents.find((a) => a.channels?.includes("voice") && a.role === "voice_sales") ??
    agents.find((a) => a.channels?.includes("voice")) ??
    agents.find((a) => a.role === "voice_sales") ??
    agents[0] ??
    null
  );
}

export async function initiateOutboundCall(
  ctx: OrgCtx,
  rawInput: InitiateCallInput,
  originUrl: string,
): Promise<VoiceCall> {
  assertOrgCtx(ctx, "Voice");
  const parsed = initiateCallInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(undefined, parsed.error.issues[0]?.message ?? "Invalid call request");
  }
  const input = parsed.data;
  const orgId = ctx.organizationId;

  const account = input.voiceAccountId
    ? await getVoiceAccount(orgId, input.voiceAccountId)
    : await getDefaultVoiceAccount(orgId);
  if (!account || !account.enabled) {
    throw new ValidationError(
      undefined,
      "No enabled voice provider account configured. Connect one in Integrations.",
    );
  }

  const order = input.orderId ? await orderRepo.get(orgId, input.orderId) : null;
  if (input.orderId && !order) {
    throw new NotFoundError("Order not found");
  }

  const targetCustomerId = input.customerId ?? order?.customerId ?? undefined;
  let customer: Customer | null = targetCustomerId
    ? await customerRepo.get(orgId, targetCustomerId)
    : null;
  if (input.customerId && !customer) {
    throw new NotFoundError("Customer not found");
  }

  const rawPhone =
    input.phoneE164 ??
    customer?.phoneE164 ??
    order?.shippingAddress?.phoneE164 ??
    order?.customerSnapshot?.phoneE164 ??
    "";
  const phoneE164 = normalizePhone(rawPhone);
  if (!phoneE164) {
    throw new ValidationError(undefined, "Enter a valid mobile phone number (e.g. +8801XXXXXXXXX)");
  }

  if (!customer) {
    customer = await findCustomerByPhone(orgId, phoneE164);
  }

  if (customer?.consent?.status === "denied") {
    throw new ConflictError("Customer has opted out of calls and messages");
  }

  const agent = await resolveVoiceAgent(orgId, input.agentId);
  const orgSnap = await adminDb().collection("organizations").doc(orgId).get();
  const orgName =
    (orgSnap.exists ? (orgSnap.data()?.name as string | undefined) : undefined) ?? "our store";

  const basePrompt = agent
    ? buildSystemPrompt({ agent, organizationName: orgName, now: new Date() })
    : `You are a polite voice sales assistant for ${orgName}. Keep replies short (1-2 sentences) because they are spoken aloud.`;

  const extraContext: string[] = [];
  if (customer) {
    extraContext.push(`Customer Name: ${customer.fullName} (${customer.phoneE164})`);
  }
  if (order) {
    extraContext.push(
      `Order Context: Order #${order.orderNumber}, status=${order.status}, paymentStatus=${order.paymentStatus}, total=৳${(order.totalMinor / 100).toFixed(0)}`,
    );
  }
  if (input.purpose) {
    extraContext.push(`Call Purpose: ${input.purpose}`);
  }
  const systemPrompt =
    extraContext.length > 0
      ? `${basePrompt}\n\nCALL CONTEXT:\n${extraContext.join("\n")}`
      : basePrompt;

  const firstMessage = customer
    ? `Hello ${customer.fullName}, calling from ${orgName}. How are you doing today?`
    : `Hello! Calling from ${orgName}. How can I help you today?`;

  const call = await createVoiceCall({
    organizationId: orgId,
    voiceAccountId: account.id,
    provider: account.provider,
    providerCallId: null,
    direction: "outbound",
    status: "queued",
    outcome: "unknown",
    customerId: customer?.id ?? null,
    customerName: customer?.fullName ?? order?.customerSnapshot?.name ?? null,
    phoneE164,
    orderId: order?.id ?? null,
    agentId: agent?.id ?? null,
    agentName: agent?.name ?? null,
    purpose: input.purpose ?? null,
    durationSeconds: 0,
    currency: account.provider === "twilio" ? "USD" : "USD",
    recordingUrl: null,
    summary: null,
    transcript: [],
    notes: null,
    endedReason: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
  });

  const cleanOrigin = originUrl.replace(/\/+$/, "");
  const webhookUrl = `${cleanOrigin}/api/webhooks/voice/${account.provider}/${account.id}`;
  const adapter = getVoiceAdapter(account.provider);

  try {
    const res = await adapter.initiateCall(account, {
      callId: call.id,
      toPhoneE164: phoneE164,
      customerName: call.customerName,
      systemPrompt,
      firstMessage,
      agentId: agent?.id ?? null,
      webhookUrl,
      toolSpecs: agent
        ? toolSpecsFor(agent).map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters as Record<string, unknown>,
          }))
        : [],
      metadata: {
        organizationId: orgId,
        salesPilotCallId: call.id,
        ...(customer ? { customerId: customer.id } : {}),
        ...(order ? { orderId: order.id } : {}),
        ...(agent ? { agentId: agent.id } : {}),
      },
    });

    const updated = await updateVoiceCall(orgId, call.id, {
      providerCallId: res.providerCallId,
      status: res.status,
    });

    await writeAudit({
      organizationId: orgId,
      actorUid: ctx.uid,
      action: "voice.call_initiated",
      resource: "voiceCall",
      resourceId: call.id,
      after: {
        provider: account.provider,
        phoneE164,
        customerId: customer?.id ?? null,
        orderId: order?.id ?? null,
      },
    });

    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Voice provider call failed";
    logger.warn("Voice outbound call initiation failed", {
      callId: call.id,
      provider: account.provider,
      error: message,
    });
    await updateVoiceCall(orgId, call.id, {
      status: "failed",
      endedReason: message.slice(0, 300),
      endedAt: new Date().toISOString(),
    });
    throw err;
  }
}
