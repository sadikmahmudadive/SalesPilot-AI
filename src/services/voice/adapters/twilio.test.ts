import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sealSecret } from "@/lib/security/secret-box";
import type { VoiceAccount } from "@/schemas/voice";

import { buildTwimlGather, buildTwimlHangup, twilioVoiceAdapter } from "./twilio";

process.env.ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const mockFetch = vi.fn();
vi.mock("@/lib/api/outbound-http", () => ({
  fetchOutboundJson: (...args: unknown[]) => mockFetch(...args),
}));

function makeAccount(): VoiceAccount {
  return {
    id: "va_twilio",
    organizationId: "org_1",
    provider: "twilio",
    label: "Twilio Voice",
    mode: "live",
    enabled: true,
    isDefault: true,
    credentials: sealSecret(JSON.stringify({ accountSid: "AC123", authToken: "tok_abc" })),
    publicConfig: { fromNumber: "+15551112222" },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("TwilioVoiceAdapter", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("initiates call via Twilio REST API and builds valid TwiML", async () => {
    mockFetch.mockResolvedValueOnce({ sid: "CA_999", status: "queued" });
    const res = await twilioVoiceAdapter.initiateCall(makeAccount(), {
      callId: "c_tw",
      toPhoneE164: "+8801712345678",
      systemPrompt: "Help customer",
      webhookUrl: "https://app.test/api/webhooks/voice/twilio/va_twilio",
    });

    expect(res.providerCallId).toBe("CA_999");
    expect(res.status).toBe("queued");

    const gather = buildTwimlGather("Hello & welcome!", "https://app.test/hook?a=1&b=2");
    expect(gather).toContain("Hello &amp; welcome!");
    expect(gather).toContain("https://app.test/hook?a=1&amp;b=2");

    const hangup = buildTwimlHangup("Goodbye!");
    expect(hangup).toContain("<Hangup/>");
  });

  it("verifies X-Twilio-Signature and parses SpeechResult & CallStatus", async () => {
    const account = makeAccount();
    const url = "https://app.test/api/webhooks/voice/twilio/va_twilio";
    const body = { CallSid: "CA_999", SpeechResult: "Yes confirm" };
    const sig = createHmac("sha1", "tok_abc")
      .update(`${url}CallSidCA_999SpeechResultYes confirm`)
      .digest("base64");

    expect(
      await twilioVoiceAdapter.verifyWebhook(account, {
        method: "POST",
        headers: { "x-twilio-signature": sig },
        url,
        rawBody: "",
        body,
      }),
    ).toBe(true);

    expect(twilioVoiceAdapter.parseWebhook({ method: "POST", headers: {}, url, rawBody: "", body })).toEqual({
      kind: "twilio_turn",
      providerCallId: "CA_999",
      speechResult: "Yes confirm",
      fromPhone: undefined,
      toPhone: undefined,
      callStatus: undefined,
      isInitialGather: false,
    });

    expect(
      twilioVoiceAdapter.parseWebhook({
        method: "POST",
        headers: {},
        url,
        rawBody: "",
        body: { CallSid: "CA_999", CallStatus: "completed", CallDuration: "18" },
      }),
    ).toMatchObject({
      kind: "status_update",
      providerCallId: "CA_999",
      status: "completed",
      durationSeconds: 18,
    });
  });
});
