/**
 * Composite indexes of the agent collections, as a typed table. Pure data, no I/O.
 *
 *   agents          (organizationId ASC, updatedAt DESC, __name__ DESC)   `listAgents`
 *   agentSessions   (organizationId ASC, agentId ASC, lastMessageAt DESC, __name__ DESC)
 *                                                                          session list of one agent
 *
 * The Firestore emulator does NOT enforce indexes, so a missing entry only fails in production.
 * `agent-indexes.test.ts` asserts that this table and the `agents` / `agentSessions` entries of
 * firestore.indexes.json are EXACTLY the same set, in the exact Firebase format.
 */
import type { FirestoreIndex } from "@/lib/firestore-index-table";

export interface AgentIndexSpec {
  collectionGroup: "agents" | "agentSessions";
  /** Fields in index order, including the trailing `__name__`. */
  fields: FirestoreIndex["fields"];
  note: string;
}

export const AGENT_LIST_INDEXES: readonly AgentIndexSpec[] = [
  {
    collectionGroup: "agents",
    fields: [
      { fieldPath: "organizationId", order: "ASCENDING" },
      { fieldPath: "updatedAt", order: "DESCENDING" },
      { fieldPath: "__name__", order: "DESCENDING" },
    ],
    note: "Agent list, most recently updated first.",
  },
  {
    collectionGroup: "agentSessions",
    fields: [
      { fieldPath: "organizationId", order: "ASCENDING" },
      { fieldPath: "agentId", order: "ASCENDING" },
      { fieldPath: "lastMessageAt", order: "DESCENDING" },
      { fieldPath: "__name__", order: "DESCENDING" },
    ],
    note: "Sessions of one agent, most recent activity first.",
  },
];

/** The entry exactly as it must appear in firestore.indexes.json (key order included). */
export function toFirestoreIndex(spec: AgentIndexSpec): FirestoreIndex {
  return {
    collectionGroup: spec.collectionGroup,
    queryScope: "COLLECTION",
    fields: spec.fields.map((f) => ({ ...f })),
  };
}
