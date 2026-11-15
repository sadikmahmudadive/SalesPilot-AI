import { describe, expect, it } from "vitest";

import {
  CALL_DIRECTIONS,
  CALL_OUTCOMES,
  CALL_STATUSES,
  VOICE_PROVIDERS,
  initiateCallInputSchema,
  updateVoiceCallSchema,
  voiceCallSchema,
} from "./voice";

describe("voice schemas", () => {
  it("exposes expected providers, directions, statuses and outcomes", () => {
    expect(VOICE_PROVIDERS).toEqual(["vapi", "twilio", "mock"]);
    expect(CALL_DIRECTIONS).toEqual(["inbound", "outbound"]);
    expect(CALL_STATUSES).toContain("completed");
    expect(CALL_OUTCOMES).toContain("order_confirmed");
  });

  it("requires at least one target in initiateCallInputSchema", () => {
    expect(initiateCallInputSchema.safeParse({}).success).toBe(false);
    expect(initiateCallInputSchema.safeParse({ phoneE164: "+8801712345678" }).success).toBe(true);
    expect(initiateCallInputSchema.safeParse({ customerId: "cust_1" }).success).toBe(true);
    expect(initiateCallInputSchema.safeParse({ orderId: "ord_1" }).success).toBe(true);
  });

  it("validates voiceCallSchema and updateVoiceCallSchema", () => {
    const parsed = voiceCallSchema.parse({
      id: "call_1",
      organizationId: "org_1",
      voiceAccountId: "va_1",
      provider: "vapi",
      providerCallId: "vapi_123",
      direction: "outbound",
      status: "completed",
      outcome: "order_confirmed",
      customerId: "cust_1",
      customerName: "Rahim",
      phoneE164: "+8801712345678",
      orderId: null,
      agentId: "ag_1",
      agentName: "Voice Assistant",
      durationSeconds: 45,
      recordingUrl: "https://example.com/rec.mp3",
      summary: "Confirmed order",
      transcript: [{ role: "assistant", text: "Hello!" }],
      endedReason: "customer-ended-call",
      startedAt: "2026-11-13T10:00:00.000Z",
      endedAt: "2026-11-13T10:00:45.000Z",
      createdAt: "2026-11-13T10:00:00.000Z",
      updatedAt: "2026-11-13T10:00:45.000Z",
    });
    expect(parsed.durationSeconds).toBe(45);
    expect(updateVoiceCallSchema.safeParse({ outcome: "follow_up", notes: "Call tomorrow" }).success).toBe(true);
    expect(updateVoiceCallSchema.safeParse({ outcome: "invalid" }).success).toBe(false);
  });
});
