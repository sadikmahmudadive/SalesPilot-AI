/**
 * WhatsApp webhook event processor. Server-only.
 *
 * Handles incoming WhatsApp webhook events from Meta: delivery/read receipts
 * and inbound customer messages. Automatically manages customer linking in CRM,
 * conversation state in Unified Inbox, and AI agent dispatch on the live WhatsApp channel.
 */
import "server-only";

import { createHash } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";

import { normalizePhone } from "@/lib/phone";
import { adminDb } from "@/lib/firebase/admin";
import { getChatProvider } from "@/lib/ai/openai-provider";
import type { WhatsAppClient } from "@/lib/whatsapp/client";
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
import { createSession, findReusableSession } from "@/services/agents/sessions";
import { resolveWhatsAppOrg, whatsappClientFor } from "@/services/whatsapp/connections";
import { runAgentTurn, type EngineDeps } from "@/services/agents/engine";

export interface WebhookHandlerDeps {
  /** Test seam: one client for every workspace (skips per-workspace resolution). */
  whatsappClient?: WhatsAppClient;
  /** Test seam: the fetch used by per-workspace clients. */
  fetchFn?: typeof fetch;
  engineDeps?: EngineDeps;
  resolveOrgId?: (phoneNumberId: string | undefined) => Promise<string | null>;
}

/**
 * The organization that owns a WhatsApp `phone_number_id`, or null. See `resolveWhatsAppOrg`:
 * the workspace that connected the number in Integrations, else the env single-number setup.
 * There is deliberately no fallback to "some organization".
 */
export const defaultResolveOrgId = resolveWhatsAppOrg;

/** `whatsappInbound/{sha256(wamid)}`: one marker per delivered message (Meta may redeliver). */
export const WHATSAPP_INBOUND = "whatsappInbound";

/**
 * Claims an inbound message id. True the first time, false for a redelivery (Meta retries a
 * webhook it did not see answered in time, and this handler runs the AI synchronously). The
 * marker is written BEFORE processing: a redelivery must never produce a second AI reply.
 */
async function claimInbound(orgId: string, messageId: string): Promise<boolean> {
  const id = createHash("sha256").update(messageId).digest("hex");
  try {
    await adminDb()
      .collection(WHATSAPP_INBOUND)
      .doc(id)
      .create({ organizationId: orgId, createdAt: FieldValue.serverTimestamp() });
    return true;
  } catch (err) {
    if ((err as { code?: unknown }).code === 6) return false; // ALREADY_EXISTS
    throw err;
  }
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
        // Replies go out from the number of the workspace the message belongs to.
        const client: WhatsAppClient | null =
          deps.whatsappClient ??
          (await whatsappClientFor(orgId, deps.fetchFn ? { fetchFn: deps.fetchFn } : {}));

        for (const msg of value.messages) {
          if (msg.type !== "text" || !msg.text?.body) continue;
          if (!(await claimInbound(orgId, msg.id))) continue;

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
              agentSessionId: null,
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
            await client?.markMessageAsRead(msg.id);
          } catch {
            // Non-critical if mark-as-read fails
          }

          // Handle AI vs Human processing
          // No sending number for this workspace (disabled or not connected): a person handles it.
          if (client && conv.status === "ai_handling" && conv.assignedAgentId) {
            try {
              const agentId = conv.assignedAgentId;
              const agentCtx = { organizationId: orgId, uid: "system:whatsapp" };
              // One agent session per conversation, so the AI keeps the conversation's history;
              // a new one only when the agent changed, the session escalated or hit its turn limit.
              let session = await findReusableSession(agentCtx, conv.agentSessionId, agentId);
              if (!session) {
                session = await createSession(agentCtx, agentId, "whatsapp");
                await adminDb()
                  .collection(CONVERSATIONS)
                  .doc(conv.id)
                  .update({ agentSessionId: session.id, updatedAt: FieldValue.serverTimestamp() });
              }

              let replyText = "";
              const engineDeps: EngineDeps = deps.engineDeps ?? {
                provider: getChatProvider(),
              };

              await runAgentTurn(engineDeps, {
                ctx: { organizationId: orgId, uid: "system:whatsapp" },
                sessionId: session.id,
                userText: msg.text.body,
                contactPhoneE164: senderPhone,
                conversationId: conv.id,
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
              await adminDb().collection(CONVERSATIONS).doc(conv.id).update({
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
