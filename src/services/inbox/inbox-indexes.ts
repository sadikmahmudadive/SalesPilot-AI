/**
 * Composite indexes of the inbox conversation collection, as a typed table. Pure data, no I/O.
 *
 *   conversations   (organizationId ASC, lastActivityAt DESC, __name__ DESC)              `listConversations` default
 *   conversations   (organizationId ASC, status ASC, lastActivityAt DESC, __name__ DESC)  `listConversations` filtered by status
 *   conversations   (organizationId ASC, contactPhoneE164 ASC, __name__ DESC)             webhook phone lookup
 */
import type { FirestoreIndex } from "@/lib/firestore-index-table";

export interface InboxIndexSpec {
  collectionGroup: "conversations";
  fields: FirestoreIndex["fields"];
  note: string;
}

export const INBOX_LIST_INDEXES: readonly InboxIndexSpec[] = [
  {
    collectionGroup: "conversations",
    fields: [
      { fieldPath: "organizationId", order: "ASCENDING" },
      { fieldPath: "lastActivityAt", order: "DESCENDING" },
      { fieldPath: "__name__", order: "DESCENDING" },
    ],
    note: "Inbox conversation list, ordered by most recent activity.",
  },
  {
    collectionGroup: "conversations",
    fields: [
      { fieldPath: "organizationId", order: "ASCENDING" },
      { fieldPath: "status", order: "ASCENDING" },
      { fieldPath: "lastActivityAt", order: "DESCENDING" },
      { fieldPath: "__name__", order: "DESCENDING" },
    ],
    note: "Inbox conversation list filtered by status, ordered by most recent activity.",
  },
  {
    collectionGroup: "conversations",
    fields: [
      { fieldPath: "organizationId", order: "ASCENDING" },
      { fieldPath: "contactPhoneE164", order: "ASCENDING" },
      { fieldPath: "__name__", order: "ASCENDING" },
    ],
    note: "Conversation lookup by contact phone number.",
  },
];

export function toFirestoreIndex(spec: InboxIndexSpec): FirestoreIndex {
  return {
    collectionGroup: spec.collectionGroup,
    queryScope: "COLLECTION",
    fields: spec.fields.map((f) => ({ ...f })),
  };
}
