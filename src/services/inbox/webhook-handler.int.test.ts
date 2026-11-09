import { describe, expect, it, beforeEach } from "vitest";

import { adminDb } from "@/lib/firebase/admin";
import type { WhatsAppWebhookPayload } from "@/lib/whatsapp/types";
import { conversationRepo } from "@/repositories/conversations";
import { addConversationMessage } from "@/repositories/inbox-messages";

import { processWhatsAppWebhook } from "./webhook-handler";

const ORG = "org_webhook_test";

describe("processWhatsAppWebhook", () => {
  beforeEach(async () => {
    const db = adminDb();
    const snaps = await db.collection("conversations").where("organizationId", "==", ORG).get();
    for (const d of snaps.docs) {
      await d.ref.delete();
    }
  });

  it("updates delivery status when receiving a status webhook event", async () => {
    const conv = await conversationRepo.create(ORG, {
      channel: "whatsapp",
      contactPhoneE164: "+8801811000001",
      contactName: "Customer 1",
      customerId: null,
      assignedAgentId: null,
      assignedUserId: null,
      status: "human_handling",
      unreadCount: 0,
      lastMessage: null,
      lastActivityAt: "2026-11-10T01:00:00.000Z",
      searchLower: "customer 1 +8801811000001",
    });

    const msg = await addConversationMessage(ORG, conv.id, {
      direction: "outbound",
      sender: "user",
      senderName: "Staff",
      type: "text",
      text: "Testing status update",
      status: "sent",
      externalId: "wamid_status_test_123",
    });

    expect(msg.status).toBe("sent");

    const payload: WhatsAppWebhookPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "wh_entry_1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+15551234567",
                  phone_number_id: "phone_num_id_123",
                },
                statuses: [
                  {
                    id: "wamid_status_test_123",
                    status: "delivered",
                    timestamp: "1794250000",
                    recipient_id: "8801811000001",
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const res = await processWhatsAppWebhook(payload, {
      resolveOrgId: async () => ORG,
    });

    expect(res.processedStatuses).toBe(1);

    const doc = await adminDb()
      .collection("conversations")
      .doc(conv.id)
      .collection("messages")
      .doc(msg.id)
      .get();

    expect(doc.data()?.status).toBe("delivered");
  });

  it("creates conversation, links customer, and marks message as read on inbound message", async () => {
    let markedReadId: string | null = null;

    const fakeClient = {
      sendTextMessage: async () => {
        return { messageId: "wamid_auto_reply" };
      },
      markMessageAsRead: async (msgId: string) => {
        markedReadId = msgId;
        return true;
      },
    };

    const payload: WhatsAppWebhookPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "wh_entry_2",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+15551234567",
                  phone_number_id: "phone_num_id_123",
                },
                contacts: [
                  {
                    profile: { name: "Anisur Rahman" },
                    wa_id: "8801911223344",
                  },
                ],
                messages: [
                  {
                    from: "8801911223344",
                    id: "wamid_inbound_999",
                    timestamp: "1794251000",
                    type: "text",
                    text: { body: "Is product X available?" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const res = await processWhatsAppWebhook(payload, {
      resolveOrgId: async () => ORG,
      whatsappClient: fakeClient as never,
    });

    expect(res.processedMessages).toBe(1);
    expect(markedReadId).toBe("wamid_inbound_999");

    // Verify conversation was created
    const convSnap = await adminDb()
      .collection("conversations")
      .where("organizationId", "==", ORG)
      .where("contactPhoneE164", "==", "+8801911223344")
      .get();

    expect(convSnap.empty).toBe(false);
    const convDoc = convSnap.docs[0]!.data();
    expect(convDoc.contactName).toBe("Anisur Rahman");
    expect(convDoc.lastMessage?.text).toBe("Is product X available?");

    // Verify message was stored in subcollection
    const msgSnap = await convSnap.docs[0]!.ref.collection("messages").get();
    expect(msgSnap.empty).toBe(false);
    expect(msgSnap.docs[0]!.data().text).toBe("Is product X available?");
    expect(msgSnap.docs[0]!.data().direction).toBe("inbound");
  });
});
