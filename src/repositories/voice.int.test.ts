import { describe, expect, it } from "vitest";

import { sealSecret } from "@/lib/security/secret-box";

process.env.ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import {
  createVoiceAccount,
  createVoiceCall,
  getDefaultVoiceAccount,
  getVoiceAccount,
  getVoiceCall,
  getVoiceCallByProviderId,
  listVoiceCalls,
  updateVoiceAccount,
  updateVoiceCall,
} from "./voice";

describe("voice repository (integration)", () => {
  it("enforces tenant isolation on voiceAccounts and manages default flag", async () => {
    const acc1 = await createVoiceAccount({
      organizationId: "org_v_1",
      provider: "vapi",
      label: "Primary Vapi",
      mode: "live",
      enabled: true,
      isDefault: true,
      credentials: sealSecret(JSON.stringify({ apiKey: "vapi_key_1" })),
      publicConfig: { phoneNumberId: "pn_1" },
    });

    const acc2 = await createVoiceAccount({
      organizationId: "org_v_1",
      provider: "twilio",
      label: "Backup Twilio",
      mode: "sandbox",
      enabled: true,
      isDefault: true,
      credentials: sealSecret(JSON.stringify({ accountSid: "AC1", authToken: "tok" })),
      publicConfig: { fromNumber: "+15550001111" },
    });

    // Cross-org read returns null
    expect(await getVoiceAccount("org_v_other", acc1.id)).toBeNull();

    // acc2 became default, acc1 is no longer default
    const reloaded1 = await getVoiceAccount("org_v_1", acc1.id);
    expect(reloaded1?.isDefault).toBe(false);
    const def = await getDefaultVoiceAccount("org_v_1");
    expect(def?.id).toBe(acc2.id);

    await updateVoiceAccount("org_v_1", acc1.id, { isDefault: true });
    expect((await getDefaultVoiceAccount("org_v_1"))?.id).toBe(acc1.id);
  });

  it("creates, queries by providerCallId, filters, and updates voiceCalls within org", async () => {
    const call = await createVoiceCall({
      organizationId: "org_v_2",
      voiceAccountId: "va_1",
      provider: "vapi",
      providerCallId: "vapi_call_999",
      direction: "outbound",
      status: "queued",
      outcome: "unknown",
      customerId: "cust_1",
      customerName: "Karim",
      phoneE164: "+8801711111111",
      orderId: "ord_1",
      agentId: "ag_1",
      agentName: "Voice Bot",
      durationSeconds: 0,
      currency: "USD",
      recordingUrl: null,
      summary: null,
      transcript: [],
      endedReason: null,
      startedAt: null,
      endedAt: null,
    });

    expect(await getVoiceCall("org_v_other", call.id)).toBeNull();
    expect((await getVoiceCallByProviderId("org_v_2", "vapi_call_999"))?.id).toBe(call.id);

    const updated = await updateVoiceCall("org_v_2", call.id, {
      status: "completed",
      outcome: "order_confirmed",
      durationSeconds: 32,
      transcript: [{ role: "assistant", text: "Hello Karim" }],
    });
    expect(updated.status).toBe("completed");
    expect(updated.outcome).toBe("order_confirmed");

    const listed = await listVoiceCalls("org_v_2", { direction: "outbound" });
    expect(listed.map((c) => c.id)).toContain(call.id);
  });
});
