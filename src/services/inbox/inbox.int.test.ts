import { describe, expect, it, beforeEach, vi } from "vitest";

import { adminDb } from "@/lib/firebase/admin";
import { ConflictError } from "@/lib/errors";
import { conversationRepo } from "@/repositories/conversations";
import { fakeMeta } from "@/test/whatsapp-meta";
import { disconnectWhatsApp, saveWhatsAppConnection } from "@/services/whatsapp/connections";

import {
  getConversation,
  listConversations,
  listMessages,
  sendHumanMessage,
  WHATSAPP_NOT_CONNECTED_MESSAGE,
  updateConversation,
} from "./inbox";

const ORG = "org_inbox_test";
const OTHER_ORG = "org_other_inbox";
const UID = "usr_staff_1";

describe("Inbox Service", () => {
  beforeEach(async () => {
    // Clean up test conversations in demo emulator
    const db = adminDb();
    const snaps = await db
      .collection("conversations")
      .where("organizationId", "in", [ORG, OTHER_ORG])
      .get();
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

  it("search finds a conversation beyond the first page, however the number is typed", async () => {
    const make = (i: number, phone: string, name: string, status: "needs_reply" | "resolved") =>
      conversationRepo.create(ORG, {
        channel: "whatsapp",
        contactPhoneE164: phone,
        contactName: name,
        customerId: null,
        assignedAgentId: null,
        assignedUserId: null,
        status,
        unreadCount: 0,
        lastMessage: null,
        lastActivityAt: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(),
        searchLower: `${name} ${phone}`.toLowerCase(),
      });
    // The oldest conversation, behind 25 newer ones.
    const old = await make(0, "+8801999888777", "Old Buyer", "resolved");
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        make(i + 1, `+88017110000${String(i).padStart(2, "0")}`, `Filler ${i}`, "needs_reply"),
      ),
    );
    const ctx = { organizationId: ORG, uid: UID };
    const ids = async (search: string, extra: object = {}) =>
      (await listConversations(ctx, { limit: 20, search, ...extra })).items.map((c) => c.id);

    expect(await ids("01999888777")).toEqual([old.id]);
    expect(await ids("+880 1999-888 777")).toEqual([old.id]);
    expect(await ids("old buy")).toEqual([old.id]);
    expect(await ids("888777", { status: "resolved" })).toEqual([old.id]);
    expect(await ids("888777", { status: "needs_reply" })).toEqual([]);

    // More matches than the limit: the newest `limit` are returned, with no cursor to a stale page.
    const many = await listConversations(ctx, { limit: 20, search: "filler" });
    expect(many.items).toHaveLength(20);
    expect(many.items[0]?.contactName).toBe("Filler 24");
    expect(many.nextCursor).toBeNull();
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
    await expect(getConversation({ organizationId: OTHER_ORG, uid: UID }, c.id)).rejects.toThrow(
      "Conversation not found",
    );
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

  it("sendHumanMessage sends from the workspace's connected number", async () => {
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    const token = "EAAG-inbox-workspace-token-0001";
    const number = `7${String(Date.now()).slice(-9)}`;
    const meta = fakeMeta({ [number]: token });
    await saveWhatsAppConnection(
      { organizationId: ORG, uid: UID },
      { phoneNumberId: number, businessAccountId: "1022901", accessToken: token, enabled: true },
      { fetchFn: meta },
    );
    const conv = await conversationRepo.create(ORG, {
      channel: "whatsapp",
      contactPhoneE164: "+8801711000009",
      contactName: "Rina",
      customerId: null,
      assignedAgentId: null,
      assignedUserId: null,
      status: "needs_reply",
      unreadCount: 1,
      lastMessage: null,
      lastActivityAt: "2026-11-10T01:00:00.000Z",
      searchLower: "rina +8801711000009",
    });
    try {
      const msg = await sendHumanMessage(
        { organizationId: ORG, uid: UID, name: "Manager Alice" },
        conv.id,
        { text: "Hello Rina" },
        { fetchFn: meta },
      );
      expect(msg.externalId).toBe("wamid.fake.1");
      expect(meta.sends).toHaveLength(1);
      expect(meta.sends[0]).toMatchObject({
        phoneNumberId: number,
        authorization: `Bearer ${token}`,
      });
    } finally {
      await disconnectWhatsApp({ organizationId: ORG, uid: UID });
      vi.unstubAllEnvs();
    }
  });

  it("sendHumanMessage refuses instead of pretending when no number is connected", async () => {
    const conv = await conversationRepo.create(ORG, {
      channel: "whatsapp",
      contactPhoneE164: "+8801711000010",
      contactName: "Mitu",
      customerId: null,
      assignedAgentId: null,
      assignedUserId: null,
      status: "needs_reply",
      unreadCount: 1,
      lastMessage: null,
      lastActivityAt: "2026-11-10T01:00:00.000Z",
      searchLower: "mitu +8801711000010",
    });
    const err = await sendHumanMessage(
      { organizationId: ORG, uid: UID, name: "Manager Alice" },
      conv.id,
      { text: "Hello" },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).message).toBe(WHATSAPP_NOT_CONNECTED_MESSAGE);
    const messages = await listMessages({ organizationId: ORG, uid: UID }, conv.id);
    expect(messages.items).toHaveLength(0);
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

    const updated = await updateConversation({ organizationId: ORG, uid: UID }, conv.id, {
      status: "resolved",
      assignedUserId: "usr_agent_2",
    });

    expect(updated.status).toBe("resolved");
    expect(updated.assignedUserId).toBe("usr_agent_2");
  });
});
