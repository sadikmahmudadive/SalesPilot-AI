/**
 * Inbox messages subcollection data access. Server-only.
 *
 *   conversations/{id}/messages/{messageId}    conversation thread messages
 */
import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import type { InboxMessage } from "@/schemas/inbox";

export const MESSAGES = "messages";

export interface CreateMessageInput {
  direction: "inbound" | "outbound";
  sender: "customer" | "agent" | "user" | "system";
  senderName: string;
  type: "text" | "interactive" | "system";
  text: string;
  status: "received" | "sent" | "delivered" | "read" | "failed";
  errorMessage?: string | null;
  externalId?: string | null;
  aiMetadata?: Record<string, unknown> | null;
  id?: string;
}

export async function addConversationMessage(
  orgId: string,
  conversationId: string,
  input: CreateMessageInput,
): Promise<InboxMessage> {
  const db = adminDb();
  const convRef = db.collection("conversations").doc(conversationId);
  const convSnap = await convRef.get();

  if (!convSnap.exists || convSnap.get("organizationId") !== orgId) {
    throw new Error("Conversation not found or access denied");
  }

  const messagesCol = convRef.collection(MESSAGES);
  const msgRef = input.id ? messagesCol.doc(input.id) : messagesCol.doc();

  const now = FieldValue.serverTimestamp();
  const payload = {
    organizationId: orgId,
    conversationId,
    direction: input.direction,
    sender: input.sender,
    senderName: input.senderName,
    type: input.type,
    text: input.text,
    status: input.status,
    errorMessage: input.errorMessage ?? null,
    externalId: input.externalId ?? null,
    aiMetadata: input.aiMetadata ?? null,
    createdAt: now,
  };

  await msgRef.set(payload);

  return {
    id: msgRef.id,
    organizationId: orgId,
    conversationId,
    direction: input.direction,
    sender: input.sender,
    senderName: input.senderName,
    type: input.type,
    text: input.text,
    status: input.status,
    errorMessage: input.errorMessage ?? null,
    externalId: input.externalId ?? null,
    aiMetadata: input.aiMetadata ?? null,
    createdAt: new Date().toISOString(),
  };
}

export async function listConversationMessages(
  orgId: string,
  conversationId: string,
  opts: { limit?: number; cursor?: string } = {},
): Promise<{ items: InboxMessage[]; nextCursor: string | null }> {
  const db = adminDb();
  const convRef = db.collection("conversations").doc(conversationId);
  const convSnap = await convRef.get();

  if (!convSnap.exists || convSnap.get("organizationId") !== orgId) {
    return { items: [], nextCursor: null };
  }

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  let q = convRef.collection(MESSAGES).orderBy("createdAt", "asc").limit(limit + 1);

  if (opts.cursor) {
    const cursorDoc = await convRef.collection(MESSAGES).doc(opts.cursor).get();
    if (cursorDoc.exists) {
      q = q.startAfter(cursorDoc);
    }
  }

  const snap = await q.get();
  const hasMore = snap.docs.length > limit;
  const docs = hasMore ? snap.docs.slice(0, limit) : snap.docs;
  const nextCursor = hasMore ? (docs[docs.length - 1]?.id ?? null) : null;

  const items: InboxMessage[] = docs.map((d) => {
    const data = d.data();
    const createdAtVal = data.createdAt;
    const createdAt =
      createdAtVal instanceof Timestamp
        ? createdAtVal.toDate().toISOString()
        : typeof createdAtVal === "string"
          ? createdAtVal
          : new Date().toISOString();

    return {
      id: d.id,
      organizationId: data.organizationId ?? orgId,
      conversationId,
      direction: data.direction,
      sender: data.sender,
      senderName: data.senderName,
      type: data.type,
      text: data.text,
      status: data.status,
      errorMessage: data.errorMessage ?? null,
      externalId: data.externalId ?? null,
      aiMetadata: data.aiMetadata ?? null,
      createdAt,
    };
  });

  return { items, nextCursor };
}

export async function updateMessageStatusByExternalId(
  externalId: string,
  newStatus: "sent" | "delivered" | "read" | "failed",
  errorMessage?: string,
): Promise<boolean> {
  const db = adminDb();
  const snap = await db.collectionGroup(MESSAGES).where("externalId", "==", externalId).limit(1).get();

  if (snap.empty) return false;
  const doc = snap.docs[0];
  if (!doc) return false;

  const patch: Record<string, unknown> = { status: newStatus };
  if (errorMessage !== undefined) patch.errorMessage = errorMessage;
  await doc.ref.update(patch);
  return true;
}
