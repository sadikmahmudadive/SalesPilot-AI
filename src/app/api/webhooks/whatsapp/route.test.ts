import { createHmac } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { GET, POST } from "./route";

const fakeVerifyToken = "test_verify_token_123";
const fakeAppSecret = "test_app_secret_456";

vi.mock("@/config/env", () => ({
  getServerEnv: () => ({
    WHATSAPP_VERIFY_TOKEN: fakeVerifyToken,
    WHATSAPP_APP_SECRET: fakeAppSecret,
  }),
}));

vi.mock("@/services/inbox/webhook-handler", () => ({
  processWhatsAppWebhook: vi.fn().mockResolvedValue({ processedMessages: 1, processedStatuses: 0 }),
}));

describe("WhatsApp Webhook Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/webhooks/whatsapp (Verification Challenge)", () => {
    it("returns 200 with challenge when mode and token match", async () => {
      const url = `http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${fakeVerifyToken}&hub.challenge=1158201444`;
      const req = new Request(url, { method: "GET" });

      const res = await GET(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe("1158201444");
    });

    it("returns 403 when verify_token does not match", async () => {
      const url = "http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=1158201444";
      const req = new Request(url, { method: "GET" });

      const res = await GET(req);
      expect(res.status).toBe(403);
    });

    it("returns 403 when hub.mode is not subscribe", async () => {
      const url = `http://localhost/api/webhooks/whatsapp?hub.mode=other&hub.verify_token=${fakeVerifyToken}&hub.challenge=1158201444`;
      const req = new Request(url, { method: "GET" });

      const res = await GET(req);
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/webhooks/whatsapp (Event Handler)", () => {
    it("returns 200 and processes event when HMAC signature is valid", async () => {
      const body = JSON.stringify({
        object: "whatsapp_business_account",
        entry: [],
      });
      const hash = createHmac("sha256", fakeAppSecret).update(body).digest("hex");

      const req = new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": `sha256=${hash}`,
        },
        body,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ status: "ok" });
    });

    it("returns 401 when signature header is missing or invalid", async () => {
      const body = JSON.stringify({ object: "whatsapp_business_account" });
      const req = new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
    });
  });
});
