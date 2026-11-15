import { describe, expect, it, vi, beforeEach } from "vitest";

import { sealSecret } from "@/lib/security/secret-box";
import type { VoiceAccount } from "@/schemas/voice";

import { vapiVoiceAdapter } from "./vapi";

process.env.ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const mockFetch = vi.fn();
vi.mock("@/lib/api/outbound-http", () => ({
  fetchOutboundJson: (...args: unknown[]) => mockFetch(...args),
}));

function makeAccount(): VoiceAccount {
  return {
    id: "va_vapi",
    organizationId: "org_1",
    provider: "vapi",
    label: "Vapi Live",
    mode: "live",
    enabled: true,
    isDefault: true,
    credentials: sealSecret(JSON.stringify({ apiKey: "vapi_secret_key" })),
    webhookSecret: sealSecret("vapi_hook_sec"),
    publicConfig: { phoneNumberId: "pn_123" },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("VapiVoiceAdapter", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("initiates call via Vapi REST API", async () => {
    mockFetch.mockResolvedValueOnce({ id: "vapi_call_1", status: "queued" });
    const res = await vapiVoiceAdapter.initiateCall(makeAccount(), {
      callId: "c_1",
      toPhoneE164: "+8801712345678",
      customerName: "Anika",
      systemPrompt: "Sell shirts",
      webhookUrl: "https://app.test/api/webhooks/voice/vapi/va_vapi",
    });

    expect(res.providerCallId).toBe("vapi_call_1");
    expect(res.status).toBe("queued");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.vapi.ai/call",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("verifies x-vapi-secret header and parses tool-calls & end-of-call-report", async () => {
    const account = makeAccount();
    expect(
      await vapiVoiceAdapter.verifyWebhook(account, {
        method: "POST",
        headers: { "x-vapi-secret": "vapi_hook_sec" },
        url: "https://app.test",
        rawBody: "{}",
        body: {},
      }),
    ).toBe(true);

    const toolEv = vapiVoiceAdapter.parseWebhook({
      method: "POST",
      headers: {},
      url: "https://app.test",
      rawBody: "",
      body: {
        message: {
          type: "tool-calls",
          call: { id: "vapi_call_1", metadata: { salesPilotCallId: "c_1" } },
          toolCallList: [
            { id: "tc_1", function: { name: "search_products", arguments: { query: "shirt" } } },
          ],
        },
      },
    });
    expect(toolEv).toEqual({
      kind: "tool_calls",
      providerCallId: "vapi_call_1",
      metadata: { salesPilotCallId: "c_1" },
      toolCalls: [{ id: "tc_1", name: "search_products", arguments: '{"query":"shirt"}' }],
    });

    const endEv = vapiVoiceAdapter.parseWebhook({
      method: "POST",
      headers: {},
      url: "https://app.test",
      rawBody: "",
      body: {
        message: {
          type: "end-of-call-report",
          call: { id: "vapi_call_1" },
          durationSeconds: 42,
          recordingUrl: "https://cdn.vapi.ai/rec.mp3",
          summary: "Confirmed order",
          endedReason: "customer-ended-call",
          messages: [
            { role: "bot", message: "Hello!" },
            { role: "user", message: "Hi, I want a shirt" },
          ],
        },
      },
    });
    expect(endEv).toMatchObject({
      kind: "status_update",
      status: "completed",
      durationSeconds: 42,
      recordingUrl: "https://cdn.vapi.ai/rec.mp3",
      transcript: [
        { role: "assistant", text: "Hello!" },
        { role: "user", text: "Hi, I want a shirt" },
      ],
    });
  });
});
