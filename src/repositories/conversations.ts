/**
 * Inbox conversations data access. Server-only.
 *
 *   conversations/{id}    conversation metadata (server-only, rules deny clients)
 *
 * Scoped by organizationId; all queries forced on organizationId.
 */
import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import type { Conversation } from "@/schemas/inbox";

import { OrgRepository, type OrgCreateInput } from "./base";

export type ConversationDoc = Conversation & { searchLower: string };

export const CONVERSATIONS = "conversations";

export const conversationRepo = new OrgRepository<ConversationDoc>(CONVERSATIONS, {
  filterable: [
    "status",
    "channel",
    "contactPhoneE164",
    "customerId",
    "assignedUserId",
    "assignedAgentId",
  ],
  sortable: ["lastActivityAt", "createdAt", "updatedAt"],
});

export function buildConversation(orgId: string, data: Record<string, unknown>) {
  return conversationRepo.build(orgId, data as unknown as OrgCreateInput<ConversationDoc>);
}

/**
 * Finds an existing conversation for a contact phone and channel within an org.
 */
export async function findConversationByContact(
  orgId: string,
  contactPhoneE164: string,
  channel: string = "whatsapp",
): Promise<ConversationDoc | null> {
  const db = adminDb();
  const snap = await db
    .collection(CONVERSATIONS)
    .where("organizationId", "==", orgId)
    .where("contactPhoneE164", "==", contactPhoneE164)
    .where("channel", "==", channel)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const doc = snap.docs[0];
  if (!doc) return null;
  return conversationRepo.fromSnapshot(doc, orgId);
}
