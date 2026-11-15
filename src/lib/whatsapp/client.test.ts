import { describe, expect, it, vi, beforeEach } from "vitest";

import { createWhatsAppClient } from "./client";

describe("WhatsAppClient", () => {
  const fakeToken = "EAAtesttoken123456";
  const fakePhoneId = "109876543210987";
  const apiVersion = "v21.0";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a text message successfully via Graph API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messaging_product: "whatsapp",
        contacts: [{ input: "8801712345678", wa_id: "8801712345678" }],
        messages: [{ id: "wamid.HBgLM..." }],
      }),
    });

    const client = createWhatsAppClient({
      accessToken: fakeToken,
      phoneNumberId: fakePhoneId,
      apiVersion,
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    const res = await client.sendTextMessage("+8801712345678", "Hello from SalesPilot!");

    expect(res.messageId).toBe("wamid.HBgLM...");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [url, options] = firstCall as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe(`https://graph.facebook.com/${apiVersion}/${fakePhoneId}/messages`);
    expect(options.method).toBe("POST");
    expect(options.headers["Authorization"]).toBe(`Bearer ${fakeToken}`);
    expect(options.headers["Content-Type"]).toBe("application/json");

    const payload = JSON.parse(options.body);
    expect(payload).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "8801712345678",
      type: "text",
      text: { body: "Hello from SalesPilot!" },
    });
  });

  it("marks a message as read successfully via Graph API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const client = createWhatsAppClient({
      accessToken: fakeToken,
      phoneNumberId: fakePhoneId,
      apiVersion,
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    const res = await client.markMessageAsRead("wamid.HBgLM...");
    expect(res).toBe(true);

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [url, options] = firstCall as [string, { body: string }];
    expect(url).toBe(`https://graph.facebook.com/${apiVersion}/${fakePhoneId}/messages`);
    const payload = JSON.parse(options.body);
    expect(payload).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.HBgLM...",
    });
  });

  it("throws WhatsAppApiError when Graph API returns an error response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: "(#100) Param recipient invalid",
          type: "OAuthException",
          code: 100,
          error_subcode: 2018001,
          fbtrace_id: "AJq...",
        },
      }),
    });

    const client = createWhatsAppClient({
      accessToken: fakeToken,
      phoneNumberId: fakePhoneId,
      apiVersion,
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    await expect(client.sendTextMessage("+8801999999999", "Hi")).rejects.toThrow(
      "WhatsApp API error: (#100) Param recipient invalid",
    );
  });
});
