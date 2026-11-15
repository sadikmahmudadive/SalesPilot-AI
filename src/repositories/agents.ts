/**
 * Agent data access. Server-only.
 *
 *   agents/{agentId}                                   the agent (see AgentDoc)
 *   agentSessions/{sessionId}                          test-chat sessions (server-only, rules deny clients)
 *   agentSessions/{sessionId}/messages/{messageId}     session messages (server-only)
 *
 * Agents are listed by `updatedAt desc` (indexes: see services/agents/agent-indexes.ts).
 */
import "server-only";

import type { Agent } from "@/schemas/agent";

import { OrgRepository, type OrgCreateInput } from "./base";

/** Stored agent: the public shape plus the service-computed sort key. */
export type AgentDoc = Agent & { nameLower: string };

export const AGENTS = "agents";
export const AGENT_SESSIONS = "agentSessions";

export const agentRepo = new OrgRepository<AgentDoc>(AGENTS, {
  sortable: ["updatedAt"],
});

/** `build` for payloads that hold Firestore sentinels (typed loosely on purpose). */
export function buildAgent(orgId: string, data: Record<string, unknown>) {
  return agentRepo.build(orgId, data as unknown as OrgCreateInput<AgentDoc>);
}
