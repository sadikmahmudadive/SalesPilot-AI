import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { sealSecret } from "@/lib/security/secret-box";
import { agentRepo } from "@/repositories/agents";
import { customerRepo } from "@/repositories/customers";
import { createVoiceAccount, getVoiceCall } from "@/repositories/voice";

import { initiateOutboundCall } from "./calls";
import { handleVoiceWebhook } from "./webhooks";

process.env.ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("voice calls & webhooks service (integration)", () => {
  it("initiates outbound call, blocks opted-out customers, and processes end-of-call & tool webhooks", async () => {
    const orgId = `org_${randomUUID()}`;
    await adminDb().collection("organizations").doc(orgId).set({
      id: orgId,
      name: "Dhaka Threads",
      slug: `dhaka-threads-${orgId}`,
      ownerUid: "u_owner",
      currency: "BDT",
      timezone: "Asia/Dhaka",
    });
    const org = { id: orgId };

    const account = await createVoiceAccount({
      organizationId: org.id,
      provider: "mock",
      label: "Mock Voice",
      mode: "mock",
      enabled: true,
      isDefault: true,
      credentials: sealSecret(JSON.stringify({})),
      webhookSecret: sealSecret("hook_sec_1"),
      publicConfig: {},
    });

    const agent = await agentRepo.create(org.id, {
      name: "Voice Sales Bot",
      nameLower: "voice sales bot",
      description: "Handles voice calls",
      role: "voice_sales",
      status: "active",
      personality: "Polite",
      instructions: "Help customers order",
      objectives: ["Confirm orders"],
      languages: ["en", "bn"],
      tools: ["lookup_customer"],
      productAccess: { mode: "all" },
      channels: ["test", "voice"],
      responseStyle: "concise",
      escalation: { keywords: ["human"], onMissingInfo: true },
      limits: { maxTurnsPerSession: 20, maxToolCallsPerTurn: 4, maxOutputTokens: 500 },
      version: 1,
      createdBy: "u_owner",
    });

    const optedInCustomer = await customerRepo.create(org.id, {
      fullName: "Nadia Rahman",
      fullNameLower: "nadia rahman",
      phone: "+8801711223344",
      phoneE164: "+8801711223344",
      address: "Banani, Dhaka",
      customerType: "retail",
      segment: "interested",
      tags: [],
      tagsLower: [],
      lastInteractionAt: null,
      totalSpendMinor: 0,
      consent: { status: "granted" },
    });

    const optedOutCustomer = await customerRepo.create(org.id, {
      fullName: "Tariq Hasan",
      fullNameLower: "tariq hasan",
      phone: "+8801811223344",
      phoneE164: "+8801811223344",
      customerType: "retail",
      segment: "new_lead",
      tags: [],
      tagsLower: [],
      lastInteractionAt: null,
      totalSpendMinor: 0,
      consent: { status: "denied" },
    });

    const ctx = { organizationId: org.id, uid: "u_owner" };

    // 1. Denied consent is blocked
    await expect(
      initiateOutboundCall(
        ctx,
        { customerId: optedOutCustomer.id, agentId: agent.id },
        "https://app.test",
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    // 2. Opted-in customer succeeds
    const call = await initiateOutboundCall(
      ctx,
      { customerId: optedInCustomer.id, agentId: agent.id, purpose: "Follow up on jacket" },
      "https://app.test",
    );
    expect(call.status).toBe("ringing");
    expect(call.providerCallId).toBe(`mock_call_${call.id}`);
    expect(call.agentId).toBe(agent.id);

    // 3. Invalid webhook secret is rejected
    await expect(
      handleVoiceWebhook("mock", account.id, {
        method: "POST",
        headers: { "x-voice-secret": "wrong" },
        url: "https://app.test",
        rawBody: "{}",
        body: { providerCallId: call.providerCallId, status: "completed" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // 4. Live tool-calls webhook runs lookup_customer on channel="voice"
    const toolRes = await handleVoiceWebhook("mock", account.id, {
      method: "POST",
      headers: { "x-voice-secret": "hook_sec_1" },
      url: "https://app.test",
      rawBody: "{}",
      body: {
        kind: "tool_calls",
        providerCallId: call.providerCallId,
        toolCalls: [{ id: "tc_1", name: "lookup_customer", arguments: { phone: optedInCustomer.phoneE164 } }],
      },
    });
    expect(toolRes.status).toBe(200);
    const results = (toolRes.body as { results: Array<{ toolCallId: string; result: string }> }).results;
    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0]!.result)).toMatchObject({ ok: true });

    // 5. End-of-call webhook updates transcript, summary, recordingUrl, and customer.lastContactedAt
    await handleVoiceWebhook("mock", account.id, {
      method: "POST",
      headers: { "x-voice-secret": "hook_sec_1" },
      url: "https://app.test",
      rawBody: "{}",
      body: {
        providerCallId: call.providerCallId,
        status: "completed",
        durationSeconds: 58,
        recordingUrl: "https://cdn.test/call.mp3",
        summary: "Customer asked for size L",
        transcript: [
          { role: "assistant", text: "Hello Nadia" },
          { role: "user", text: "Do you have size L?" },
        ],
      },
    });

    const updatedCall = await getVoiceCall(org.id, call.id);
    expect(updatedCall?.status).toBe("completed");
    expect(updatedCall?.durationSeconds).toBe(58);
    expect(updatedCall?.recordingUrl).toBe("https://cdn.test/call.mp3");
    expect(updatedCall?.transcript).toHaveLength(2);

    const updatedCustomer = await customerRepo.get(org.id, optedInCustomer.id);
    expect((updatedCustomer as unknown as { lastContactedAt?: unknown })?.lastContactedAt).toBeTruthy();
  });
});
