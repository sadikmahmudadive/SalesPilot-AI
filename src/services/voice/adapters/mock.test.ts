import { describe, expect, it } from "vitest";

import { sealSecret } from "@/lib/security/secret-box";
import type { VoiceAccount } from "@/schemas/voice";

import { mockVoiceAdapter } from "./mock";

process.env.ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function makeAccount(secret?: string): VoiceAccount {
  return {
    id: "va_mock",
    organizationId: "org_1",
    provider: "mock",
    label: "Mock Voice",
    mode: "mock",
    enabled: true,
    isDefault: true,
    credentials: sealSecret(JSON.stringify({})),
    webhookSecret: secret ? sealSecret(secret) : undefined,
    publicConfig: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("MockVoiceAdapter", () => {
  it("initiates mock outbound call and parses status & tool-call webhooks", async () => {
    const account = makeAccount("sec_123");
    await expect(mockVoiceAdapter.testConnection(account)).resolves.toBeUndefined();

    const init = await mockVoiceAdapter.initiateCall(account, {
      callId: "c1",
      toPhoneE164: "+8801712345678",
      systemPrompt: "Be helpful",
      webhookUrl: "https://app.test/api/webhooks/voice/mock/va_mock",
    });
    expect(init.providerCallId).toBe("mock_call_c1");
    expect(init.status).toBe("ringing");

    expect(
      await mockVoiceAdapter.verifyWebhook(account, {
        method: "POST",
        headers: { "x-voice-secret": "sec_123" },
        url: "https://app.test/webhook",
        rawBody: "{}",
        body: {},
      }),
    ).toBe(true);

    expect(
      await mockVoiceAdapter.verifyWebhook(account, {
        method: "POST",
        headers: { "x-voice-secret": "wrong" },
        url: "https://app.test/webhook",
        rawBody: "{}",
        body: {},
      }),
    ).toBe(false);

    const statusEv = mockVoiceAdapter.parseWebhook({
      method: "POST",
      headers: {},
      url: "https://app.test",
      rawBody: "",
      body: {
        providerCallId: "mock_call_c1",
        status: "completed",
        durationSeconds: 30,
        summary: "Customer ordered shirt",
      },
    });
    expect(statusEv).toMatchObject({
      kind: "status_update",
      status: "completed",
      durationSeconds: 30,
    });
  });
});
