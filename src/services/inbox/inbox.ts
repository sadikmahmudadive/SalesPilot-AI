/**
 * Unified inbox service. Server-only.
 *
 * Implements conversation listing, message history, human outbound messaging,
 * and conversation lifecycle updates (takeover, hand back to AI, resolve).
 */
import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { isConfigured } from "@/config/env";
import { NotFoundError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { writeAudit } from "@/lib/security/audit";
import { createWhatsAppClient } from "@/lib/whatsapp/client";
import {
  conversationRepo,
  CONVERSATIONS,
  type ConversationDoc,
} from "@/repositories/conversations";
import {
  addConversationMessage,
  listConversationMessages,
} from "@/repositories/inbox-messages";
import type {
  Conversation,
  ConversationListQuery,
  InboxMessage,
  SendMessageInput,
  UpdateConversationInput,
} from "@/schemas/inbox";

export interface InboxCtx {
  organizationId: string;
  uid: string;
  name?: string;
}

export async function listConversations(
  ctx: InboxCtx,
  query: Partial<ConversationListQuery> = {},
): Promise<{ items: Conversation[]; nextCursor: string | null }> {
  const db = adminDb();
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);

  let q = db
    .collection(CONVERSATIONS)
    .where("organizationId", "==", ctx.organizationId);

  if (query.status) {
    q = q.where("status", "==", query.status);
  }

  q = q.orderBy("lastActivityAt", "desc").limit(limit + 1);

  if (query.cursor) {
    const cursorDoc = await db.collection(CONVERSATIONS).doc(query.cursor).get();
    if (cursorDoc.exists) {
      q = q.startAfter(cursorDoc);
    }
  }

  const snap = await q.get();
  const hasMore = snap.docs.length > limit;
  const docs = hasMore ? snap.docs.slice(0, limit) : snap.docs;
  const nextCursor = hasMore ? (docs[docs.length - 1]?.id ?? null) : null;

  let items: Conversation[] = docs
    .map((d) => conversationRepo.fromSnapshot(d, ctx.organizationId))
    .filter((c): c is ConversationDoc => c !== null);

  if (query.search) {
    const term = query.search.toLowerCase();
    items = items.filter(
      (c) =>
        c.contactName.toLowerCase().includes(term) ||
        c.contactPhoneE164.includes(term),
    );
  }

  return { items, nextCursor };
}

export async function getConversation(
  ctx: InboxCtx,
  id: string,
): Promise<Conversation> {
  const db = adminDb();
  const doc = await db.collection(CONVERSATIONS).doc(id).get();
  const conv = conversationRepo.fromSnapshot(doc, ctx.organizationId);
  if (!conv) throw new NotFoundError("Conversation not found");
  return conv;
}

export async function listMessages(
  ctx: InboxCtx,
  conversationId: string,
  opts: { limit?: number; cursor?: string } = {},
): Promise<{ items: InboxMessage[]; nextCursor: string | null }> {
  // Ensure caller has access to this conversation
  await getConversation(ctx, conversationId);
  return listConversationMessages(ctx.organizationId, conversationId, opts);
}

export async function sendHumanMessage(
  ctx: InboxCtx,
  conversationId: string,
  input: SendMessageInput,
  deps?: { whatsappClient?: ReturnType<typeof createWhatsAppClient> },
): Promise<InboxMessage> {
  const conv = await getConversation(ctx, conversationId);

  const client = deps?.whatsappClient ?? createWhatsAppClient();
  let externalId: string | null = null;

  if (conv.channel === "whatsapp") {
    if (deps?.whatsappClient || isConfigured("whatsapp")) {
      const sendRes = await client.sendTextMessage(conv.contactPhoneE164, input.text);
      externalId = sendRes.messageId;
    } else {
      externalId = `wamid_sim_${Date.now()}`;
    }
  }

  const senderName = ctx.name?.trim() || "Staff Member";
  const now = new Date().toISOString();

  const msg = await addConversationMessage(ctx.organizationId, conversationId, {
    direction: "outbound",
    sender: "user",
    senderName,
    type: "text",
    text: input.text,
    status: "sent",
    externalId,
  });

  const db = adminDb();
  const convRef = db.collection(CONVERSATIONS).doc(conversationId);

  const patch: Record<string, unknown> = {
    lastMessage: {
      text: input.text,
      sender: "user",
      senderName,
      at: now,
    },
    lastActivityAt: now,
    unreadCount: 0,
    updatedAt: FieldValue.serverTimestamp(),
  };

  // If AI was handling or waiting, human sending a message takes control
  if (conv.status === "ai_handling" || conv.status === "needs_reply") {
    patch.status = "human_handling";
  }
  if (!conv.assignedUserId) {
    patch.assignedUserId = ctx.uid;
  }

  await convRef.update(patch);

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUid: ctx.uid,
    action: "inbox.reply",
    resource: "conversations",
    resourceId: conversationId,
    after: { textLength: input.text.length, channel: conv.channel },
  });

  return msg;
}

export async function updateConversation(
  ctx: InboxCtx,
  id: string,
  patch: UpdateConversationInput,
): Promise<Conversation> {
  const conv = await getConversation(ctx, id);
  const db = adminDb();
  const convRef = db.collection(CONVERSATIONS).doc(id);

  const updates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  let auditAction = "inbox.update";

  if (patch.status !== undefined) {
    updates.status = patch.status;
    if (patch.status === "resolved") auditAction = "inbox.resolve";
    else if (patch.status === "human_handling" && conv.status === "ai_handling") {
      auditAction = "inbox.takeover";
    } else if (patch.status === "ai_handling" && conv.status === "human_handling") {
      auditAction = "inbox.handover_ai";
    }
  }

  if (patch.assignedUserId !== undefined) {
    updates.assignedUserId = patch.assignedUserId;
  }

  if (patch.assignedAgentId !== undefined) {
    updates.assignedAgentId = patch.assignedAgentId;
  }

  await convRef.update(updates);

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUid: ctx.uid,
    action: auditAction,
    resource: "conversations",
    resourceId: id,
    before: {
      status: conv.status,
      assignedUserId: conv.assignedUserId,
      assignedAgentId: conv.assignedAgentId,
    },
    after: {
      status: updates.status ?? conv.status,
      assignedUserId: updates.assignedUserId !== undefined ? updates.assignedUserId : conv.assignedUserId,
      assignedAgentId: updates.assignedAgentId !== undefined ? updates.assignedAgentId : conv.assignedAgentId,
    },
  });

  return getConversation(ctx, id);
}
