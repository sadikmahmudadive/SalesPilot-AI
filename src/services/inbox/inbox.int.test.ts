import { describe, expect, it, beforeEach } from "vitest";

import { adminDb } from "@/lib/firebase/admin";
import { conversationRepo } from "@/repositories/conversations";

import {
  getConversation,
  listConversations,
  listMessages,
  sendHumanMessage,
  updateConversation,
} from "./inbox";

const ORG = "org_inbox_test";
const OTHER_ORG = "org_other_inbox";
const UID = "usr_staff_1";

describe("Inbox Service", () => {
  beforeEach(async () => {
    // Clean up test conversations in demo emulator
    const db = adminDb();
    const snaps = await db.collection("conversations").where("organizationId", "in", [ORG, OTHER_ORG]).get();
    for (const d of snaps.docs) {
      await d.ref.delete();
    }
  });

  it("lists conversations scoped to organization, ordered by lastActivityAt desc", async () => {
    const c1 = await conversationRepo.create(ORG, {
      channel: "whatsapp",
      contactPhoneE164: "+8801711000001",
      contactName: "Rahim",
      customerId: null,
      assignedAgentId: null,
      assignedUserId: null,
      status: "needs_reply",
      unreadCount: 1,
      lastMessage: null,
      lastActivityAt: "2026-11-10T01:00:00.000Z",
      searchLower: "rahim +8801711000001",
    });

    const c2 = await conversationRepo.create(ORG, {
      channel: "whatsapp",
      contactPhoneE164: "+8801711000002",
      contactName: "Karim",
      customerId: null,
      assignedAgentId: null,
      assignedUserId: null,
      status: "resolved",
      unreadCount: 0,
      lastMessage: null,
      lastActivityAt: "2026-11-10T02:00:00.000Z",
      searchLower: "karim +8801711000002",
    });

    // Foreign org conversation should never appear
    await conversationRepo.create(OTHER_ORG, {
      channel: "whatsapp",
      contactPhoneE164: "+8801711000099",
      contactName: "Intruder",
      customerId: null,
      assignedAgentId: null,
      assignedUserId: null,
      status: "needs_reply",
      unreadCount: 1,
      lastMessage: null,
      lastActivityAt: "2026-11-10T03:00:00.000Z",
      searchLower: "intruder +8801711000099",
    });

    const res = await listConversations({ organizationId: ORG, uid: UID }, {});
    expect(res.items.length).toBe(2);
    // c2 had later activity than c1
    expect(res.items[0]?.id).toBe(c2.id);
    expect(res.items[1]?.id).toBe(c1.id);

    // Filtering by status
    const statusFiltered = await listConversations(
      { organizationId: ORG, uid: UID },
      { status: "needs_reply" },
    );
    expect(statusFiltered.items.length).toBe(1);
    expect(statusFiltered.items[0]?.id).toBe(c1.id);

    // Searching
    const searchFiltered = await listConversations(
      { organizationId: ORG, uid: UID },
      { search: "karim" },
    );
    expect(searchFiltered.items.length).toBe(1);
    expect(searchFiltered.items[0]?.id).toBe(c2.id);
  });

  it("getConversation enforces tenant isolation", async () => {
    const c = await conversationRepo.create(ORG, {
      channel: "whatsapp",
      contactPhoneE164: "+8801711000003",
      contactName: "Selim",
      customerId: null,
      assignedAgentId: null,
      assignedUserId: null,
      status: "ai_handling",
      unreadCount: 0,
      lastMessage: null,
      lastActivityAt: "2026-11-10T01:00:00.000Z",
      searchLower: "selim +8801711000003",
    });

    const found = await getConversation({ organizationId: ORG, uid: UID }, c.id);
    expect(found.id).toBe(c.id);

    // Cross-tenant access throws NotFound
    await expect(
      getConversation({ organizationId: OTHER_ORG, uid: UID }, c.id),
    ).rejects.toThrow("Conversation not found");
  });

  it("sendHumanMessage sends via WhatsApp client, switches status to human_handling, and clears unread", async () => {
    const conv = await conversationRepo.create(ORG, {
      channel: "whatsapp",
      contactPhoneE164: "+8801711000004",
      contactName: "Tanvir",
      customerId: null,
      assignedAgentId: "agent_123",
      assignedUserId: null,
      status: "ai_handling",
      unreadCount: 2,
      lastMessage: null,
      lastActivityAt: "2026-11-10T01:00:00.000Z",
      searchLower: "tanvir +8801711000004",
    });

    const fakeClient = {
      sendTextMessage: async () => ({ messageId: "wamid_sent_123" }),
      markMessageAsRead: async () => true,
    };

    const msg = await sendHumanMessage(
      { organizationId: ORG, uid: UID, name: "Manager Alice" },
      conv.id,
      { text: "Hello Tanvir, I am taking over your chat." },
      { whatsappClient: fakeClient as never },
    );

    expect(msg.sender).toBe("user");
    expect(msg.senderName).toBe("Manager Alice");
    expect(msg.text).toBe("Hello Tanvir, I am taking over your chat.");
    expect(msg.externalId).toBe("wamid_sent_123");

    const updated = await getConversation({ organizationId: ORG, uid: UID }, conv.id);
    expect(updated.status).toBe("human_handling");
    expect(updated.assignedUserId).toBe(UID);
    expect(updated.unreadCount).toBe(0);
    expect(updated.lastMessage?.text).toBe("Hello Tanvir, I am taking over your chat.");

    const messages = await listMessages({ organizationId: ORG, uid: UID }, conv.id);
    expect(messages.items.length).toBe(1);
    expect(messages.items[0]?.id).toBe(msg.id);
  });

  it("updateConversation transitions status, assigns user/agent, and records audit", async () => {
    const conv = await conversationRepo.create(ORG, {
      channel: "whatsapp",
      contactPhoneE164: "+8801711000005",
      contactName: "Nadia",
      customerId: null,
      assignedAgentId: null,
      assignedUserId: null,
      status: "needs_reply",
      unreadCount: 1,
      lastMessage: null,
      lastActivityAt: "2026-11-10T01:00:00.000Z",
      searchLower: "nadia +8801711000005",
    });

    const updated = await updateConversation(
      { organizationId: ORG, uid: UID },
      conv.id,
      { status: "resolved", assignedUserId: "usr_agent_2" },
    );

    expect(updated.status).toBe("resolved");
    expect(updated.assignedUserId).toBe("usr_agent_2");
  });
});
