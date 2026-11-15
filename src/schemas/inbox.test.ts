import { describe, expect, it } from "vitest";

import {
  CONVERSATION_CHANNELS,
  CONVERSATION_STATUSES,
  MESSAGE_SENDERS,
  MESSAGE_STATUSES,
  MESSAGE_TYPES,
  conversationListQuerySchema,
  conversationSchema,
  inboxMessageSchema,
  sendMessageInputSchema,
  updateConversationSchema,
} from "./inbox";

describe("inbox constants", () => {
  it("exposes expected conversation channels", () => {
    expect(CONVERSATION_CHANNELS).toContain("whatsapp");
    expect(CONVERSATION_CHANNELS).toContain("messenger");
    expect(CONVERSATION_CHANNELS).toContain("instagram");
    expect(CONVERSATION_CHANNELS).toContain("email");
  });

  it("exposes expected conversation statuses", () => {
    expect(CONVERSATION_STATUSES).toEqual([
      "ai_handling",
      "needs_reply",
      "human_handling",
      "resolved",
    ]);
  });

  it("exposes expected message senders", () => {
    expect(MESSAGE_SENDERS).toEqual(["customer", "agent", "user", "system"]);
  });

  it("exposes expected message statuses", () => {
    expect(MESSAGE_STATUSES).toEqual(["received", "sent", "delivered", "read", "failed"]);
  });

  it("exposes expected message types", () => {
    expect(MESSAGE_TYPES).toEqual(["text", "interactive", "system"]);
  });
});

describe("conversationListQuerySchema", () => {
  it("defaults limit to 20", () => {
    const res = conversationListQuerySchema.parse({});
    expect(res.limit).toBe(20);
    expect(res.cursor).toBeUndefined();
    expect(res.status).toBeUndefined();
    expect(res.search).toBeUndefined();
  });

  it("accepts valid limit, status, search, and cursor", () => {
    const res = conversationListQuerySchema.parse({
      limit: "50",
      status: "needs_reply",
      search: "Rahim",
      cursor: "abc",
    });
    expect(res).toEqual({
      limit: 50,
      status: "needs_reply",
      search: "Rahim",
      cursor: "abc",
    });
  });

  it("rejects limits outside 1..100", () => {
    expect(() => conversationListQuerySchema.parse({ limit: 0 })).toThrow();
    expect(() => conversationListQuerySchema.parse({ limit: 101 })).toThrow();
  });

  it("rejects invalid status", () => {
    expect(() => conversationListQuerySchema.parse({ status: "bogus" })).toThrow();
  });
});

describe("sendMessageInputSchema", () => {
  it("parses valid text message and trims", () => {
    const res = sendMessageInputSchema.parse({ text: "  Hello! How can I help you?  " });
    expect(res.text).toBe("Hello! How can I help you?");
  });

  it("rejects empty text or whitespace", () => {
    expect(() => sendMessageInputSchema.parse({ text: "" })).toThrow();
    expect(() => sendMessageInputSchema.parse({ text: "   " })).toThrow();
  });

  it("rejects text longer than 4096 characters", () => {
    expect(() => sendMessageInputSchema.parse({ text: "a".repeat(4097) })).toThrow();
  });
});

describe("updateConversationSchema", () => {
  it("accepts valid status change", () => {
    const res = updateConversationSchema.parse({ status: "human_handling" });
    expect(res.status).toBe("human_handling");
  });

  it("accepts assigned user and agent id", () => {
    const res = updateConversationSchema.parse({
      assignedUserId: "usr_123",
      assignedAgentId: "agent_456",
    });
    expect(res.assignedUserId).toBe("usr_123");
    expect(res.assignedAgentId).toBe("agent_456");
  });

  it("accepts null to clear assignment", () => {
    const res = updateConversationSchema.parse({
      assignedUserId: null,
      assignedAgentId: null,
    });
    expect(res.assignedUserId).toBeNull();
    expect(res.assignedAgentId).toBeNull();
  });

  it("rejects empty patch", () => {
    expect(() => updateConversationSchema.parse({})).toThrow();
  });
});

describe("conversationSchema and inboxMessageSchema", () => {
  it("parses a valid conversation object", () => {
    const validConv = {
      id: "conv_1",
      organizationId: "org_1",
      channel: "whatsapp",
      contactPhoneE164: "+8801712345678",
      contactName: "Rahim Uddin",
      customerId: "cust_1",
      assignedAgentId: "agent_1",
      assignedUserId: null,
      status: "ai_handling",
      unreadCount: 0,
      lastMessage: {
        text: "Price of cotton shirt?",
        sender: "customer",
        senderName: "Rahim Uddin",
        at: "2026-11-10T00:00:00.000Z",
      },
      lastActivityAt: "2026-11-10T00:00:00.000Z",
      createdAt: "2026-11-10T00:00:00.000Z",
      updatedAt: "2026-11-10T00:00:00.000Z",
    };
    const parsed = conversationSchema.parse(validConv);
    expect(parsed.id).toBe("conv_1");
    expect(parsed.channel).toBe("whatsapp");
  });

  it("parses a valid inbox message object", () => {
    const validMsg = {
      id: "wamid_123",
      organizationId: "org_1",
      conversationId: "conv_1",
      direction: "inbound",
      sender: "customer",
      senderName: "Rahim Uddin",
      type: "text",
      text: "Hello",
      status: "received",
      errorMessage: null,
      externalId: "wamid_123",
      aiMetadata: null,
      createdAt: "2026-11-10T00:00:00.000Z",
    };
    const parsed = inboxMessageSchema.parse(validMsg);
    expect(parsed.id).toBe("wamid_123");
    expect(parsed.direction).toBe("inbound");
  });
});
