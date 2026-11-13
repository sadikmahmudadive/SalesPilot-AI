/**
 * WhatsApp webhook event processor. Server-only.
 *
 * Handles incoming WhatsApp webhook events from Meta: delivery/read receipts
 * and inbound customer messages. Automatically manages customer linking in CRM,
 * conversation state in Unified Inbox, and AI agent dispatch on the live WhatsApp channel.
 */
import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { normalizePhone } from "@/lib/phone";
import { adminDb } from "@/lib/firebase/admin";
import { getChatProvider } from "@/lib/ai/openai-provider";
import { createWhatsAppClient } from "@/lib/whatsapp/client";
import type { WhatsAppWebhookPayload } from "@/lib/whatsapp/types";
import {
  conversationRepo,
  findConversationByContact,
  CONVERSATIONS,
  type ConversationDoc,
} from "@/repositories/conversations";
import {
  addConversationMessage,
  updateMessageStatusByExternalId,
} from "@/repositories/inbox-messages";
import { createCustomer } from "@/services/crm/customers";
import { customerInputSchema } from "@/schemas/customer";
import { listAgents } from "@/services/agents/agents";
import { createSession } from "@/services/agents/sessions";
import { runAgentTurn, type EngineDeps } from "@/services/agents/engine";

export interface WebhookHandlerDeps {
  whatsappClient?: ReturnType<typeof createWhatsAppClient>;
  engineDeps?: EngineDeps;
  resolveOrgId?: (phoneNumberId: string) => Promise<string | null>;
}

/**
 * Finds the organization associated with a WhatsApp phone_number_id.
 * Falls back to the first available organization in Firestore if unmapped.
 */
export async function defaultResolveOrgId(phoneNumberId: string): Promise<string | null> {
  const db = adminDb();

  // Try finding an organization with matching WhatsApp configuration
  const orgsSnap = await db.collection("organizations").limit(10).get();
  if (orgsSnap.empty) return null;

  for (const doc of orgsSnap.docs) {
    const data = doc.data();
    if (data.integrations?.whatsapp?.phoneNumberId === phoneNumberId) {
      return doc.id;
    }
  }

  // Fallback to primary/first organization
  const firstOrg = orgsSnap.docs[0];
  return firstOrg ? firstOrg.id : null;
}

export async function processWhatsAppWebhook(
  payload: WhatsAppWebhookPayload,
  deps: WebhookHandlerDeps = {},
): Promise<{ processedMessages: number; processedStatuses: number }> {
  let processedMessages = 0;
  let processedStatuses = 0;

  if (payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) {
    return { processedMessages, processedStatuses };
  }

  const client = deps.whatsappClient ?? createWhatsAppClient();
  const resolveOrg = deps.resolveOrgId ?? defaultResolveOrgId;

  for (const entry of payload.entry) {
    if (!Array.isArray(entry.changes)) continue;

    for (const change of entry.changes) {
      const value = change.value;
      if (!value || value.messaging_product !== "whatsapp") continue;

      const phoneNumberId = value.metadata?.phone_number_id;

      // 1. Process message status updates (sent -> delivered -> read / failed)
      if (Array.isArray(value.statuses)) {
        for (const status of value.statuses) {
          const errDetail = status.errors?.[0]?.message;
          await updateMessageStatusByExternalId(status.id, status.status, errDetail);
          processedStatuses++;
        }
      }

      // 2. Process incoming customer messages
      if (Array.isArray(value.messages)) {
        const orgId = await resolveOrg(phoneNumberId);
        if (!orgId) continue;

        for (const msg of value.messages) {
          if (msg.type !== "text" || !msg.text?.body) continue;

          const rawPhone = msg.from;
          const senderPhone = normalizePhone(rawPhone) ?? `+${rawPhone}`;
          const contactName =
            value.contacts?.find((c) => c.wa_id === rawPhone)?.profile?.name?.trim() ||
            "WhatsApp Customer";

          // Find or create CRM customer
          let customerId: string | null = null;
          try {
            const customerSnap = await adminDb()
              .collection("customers")
              .where("organizationId", "==", orgId)
              .where("phoneE164", "==", senderPhone)
              .limit(1)
              .get();

            if (!customerSnap.empty && customerSnap.docs[0]) {
              customerId = customerSnap.docs[0].id;
            } else {
              const newCustomer = await createCustomer(
                { organizationId: orgId, uid: "system:whatsapp" },
                customerInputSchema.parse({
                  fullName: contactName,
                  phone: senderPhone,
                  customerType: "retail",
                  segment: "new_lead",
                  tags: ["whatsapp"],
                  leadSource: "whatsapp",
                  consent: { status: "unknown" },
                }),
              );
              customerId = newCustomer.id;
            }
          } catch {
            // Customer creation failure shouldn't drop the incoming message
          }

          // Find or create Conversation
          let conv: ConversationDoc | null = await findConversationByContact(
            orgId,
            senderPhone,
            "whatsapp",
          );

          if (!conv) {
            // Check for an active WhatsApp agent to assign
            let defaultAgentId: string | null = null;
            try {
              const agents = await listAgents(
                { organizationId: orgId, uid: "system:whatsapp" },
                { limit: 20 },
              );
              const waAgent = agents.items.find(
                (a) => a.status === "active" && a.channels.includes("whatsapp"),
              );
              if (waAgent) defaultAgentId = waAgent.id;
            } catch {
              // Ignore agent lookup errors
            }

            const now = new Date().toISOString();
            const created = await conversationRepo.create(orgId, {
              channel: "whatsapp",
              contactPhoneE164: senderPhone,
              contactName,
              customerId,
              assignedAgentId: defaultAgentId,
              assignedUserId: null,
              status: defaultAgentId ? "ai_handling" : "needs_reply",
              unreadCount: 1,
              lastMessage: {
                text: msg.text.body,
                sender: "customer",
                senderName: contactName,
                at: now,
              },
              lastActivityAt: now,
              searchLower: `${contactName} ${senderPhone}`.toLowerCase(),
            });
            conv = created;
          }

          // Persist inbound message in conversation subcollection
          await addConversationMessage(orgId, conv.id, {
            id: msg.id,
            direction: "inbound",
            sender: "customer",
            senderName: contactName,
            type: "text",
            text: msg.text.body,
            status: "received",
            externalId: msg.id,
          });

          // Mark message as read on WhatsApp
          try {
            await client.markMessageAsRead(msg.id);
          } catch {
            // Non-critical if mark-as-read fails
          }

          // Handle AI vs Human processing
          if (conv.status === "ai_handling" && conv.assignedAgentId) {
            try {
              const agentId = conv.assignedAgentId;
              const session = await createSession(
                { organizationId: orgId, uid: "system:whatsapp" },
                agentId,
                "whatsapp",
              );

              let replyText = "";
              const engineDeps: EngineDeps = deps.engineDeps ?? {
                provider: getChatProvider(),
              };

              await runAgentTurn(engineDeps, {
                ctx: { organizationId: orgId, uid: "system:whatsapp" },
                sessionId: session.id,
                userText: msg.text.body,
                contactPhoneE164: senderPhone,
                emit: (event) => {
                  if (event.type === "text_delta") {
                    replyText += event.text;
                  }
                },
              });

              if (replyText.trim().length > 0) {
                // Send outbound WhatsApp reply
                const sendRes = await client.sendTextMessage(senderPhone, replyText.trim());

                // Persist outbound agent message
                await addConversationMessage(orgId, conv.id, {
                  direction: "outbound",
                  sender: "agent",
                  senderName: "AI Assistant",
                  type: "text",
                  text: replyText.trim(),
                  status: "sent",
                  externalId: sendRes.messageId,
                });

                // Update conversation metadata
                const now = new Date().toISOString();
                await adminDb()
                  .collection(CONVERSATIONS)
                  .doc(conv.id)
                  .update({
                    lastMessage: {
                      text: replyText.trim(),
                      sender: "agent",
                      senderName: "AI Assistant",
                      at: now,
                    },
                    lastActivityAt: now,
                    updatedAt: FieldValue.serverTimestamp(),
                  });
              }
            } catch {
              // On AI failure, mark conversation for human attention
              await adminDb()
                .collection(CONVERSATIONS)
                .doc(conv.id)
                .update({
                  status: "needs_reply",
                  updatedAt: FieldValue.serverTimestamp(),
                });
            }
          } else {
            // Human handling: increment unreadCount and update conversation status
            const now = new Date().toISOString();
            await adminDb()
              .collection(CONVERSATIONS)
              .doc(conv.id)
              .update({
                status: "needs_reply",
                unreadCount: FieldValue.increment(1),
                lastMessage: {
                  text: msg.text.body,
                  sender: "customer",
                  senderName: contactName,
                  at: now,
                },
                lastActivityAt: now,
                updatedAt: FieldValue.serverTimestamp(),
              });
          }

          processedMessages++;
        }
      }
    }
  }

  return { processedMessages, processedStatuses };
}
