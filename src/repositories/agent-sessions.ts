/**
 * Agent sessions and messages data access. Server-only.
 *
 *   agentSessions/{sessionId}                          the session metadata (rules deny clients)
 *   agentSessions/{sessionId}/messages/{messageId}     session messages (rules deny clients)
 *
 * Sessions are listed by `lastMessageAt desc` (indexes: see services/agents/agent-indexes.ts).
 */
import "server-only";

import type { AgentChannel } from "@/schemas/agent";
import type { DryRunAction } from "@/services/agents/tools/types";

import { OrgRepository, type OrgCreateInput } from "./base";

export type AgentSessionStatus = "open" | "escalated" | "closed";

export interface AgentSession {
  id: string;
  organizationId: string;
  agentId: string;
  agentVersion: number;
  channel: AgentChannel;
  startedBy: string;
  status: AgentSessionStatus;
  escalationReason?: string;
  turnCount: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  createdAt: string;
  lastMessageAt: string;
}

export interface AgentToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  resultSummary: string;
  dryRunAction?: DryRunAction;
  status: "ok" | "error" | "denied";
  durationMs: number;
}

export interface AgentMessage {
  id: string;
  organizationId: string;
  sessionId: string;
  role: "user" | "assistant";
  text: string;
  agentVersion?: number;
  toolCalls?: AgentToolCallRecord[];
  warnings?: string[];
  model?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  latencyMs?: number;
  interrupted?: boolean;
  errorCode?: string;
  createdAt: string;
}

export const AGENT_SESSIONS = "agentSessions";

export const sessionRepo = new OrgRepository<AgentSession>(AGENT_SESSIONS, {
  filterable: ["agentId"],
  sortable: ["lastMessageAt"],
});

export function buildSession(orgId: string, data: Record<string, unknown>) {
  return sessionRepo.build(orgId, data as unknown as OrgCreateInput<AgentSession>);
}
