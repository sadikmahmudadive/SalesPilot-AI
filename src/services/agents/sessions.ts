/**
 * Agent session lifecycle and retrieval. Server-only.
 */
import "server-only";

import { NotFoundError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import {
  sessionRepo,
  AGENT_SESSIONS,
  type AgentMessage,
  type AgentSession,
} from "@/repositories/agent-sessions";
import type { AgentChannel } from "@/schemas/agent";

import type { AgentCtx } from "./agents";
import { getAgent } from "./agents";

export interface ListSessionsQuery {
  limit?: number;
  cursor?: string;
}

/**
 * Creates a new chat session with an agent.
 * Works for both active and inactive agents in test mode.
 */
export async function createSession(
  ctx: AgentCtx,
  agentId: string,
  channel: AgentChannel = "test",
): Promise<AgentSession> {
  const agent = await getAgent(ctx, agentId);
  const now = new Date().toISOString();

  return sessionRepo.create(ctx.organizationId, {
    agentId,
    agentVersion: agent.version,
    channel,
    startedBy: ctx.uid,
    status: "open",
    turnCount: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    lastMessageAt: now,
  });
}

/**
 * Loads a session along with its message history (ordered oldest to newest).
 */
export async function getSessionWithMessages(
  ctx: AgentCtx,
  sessionId: string,
): Promise<{ session: AgentSession; messages: AgentMessage[] }> {
  const session = await sessionRepo.get(ctx.organizationId, sessionId);
  if (!session) throw new NotFoundError();

  const snap = await adminDb()
    .collection(AGENT_SESSIONS)
    .doc(sessionId)
    .collection("messages")
    .orderBy("createdAt", "asc")
    .get();

  const messages: AgentMessage[] = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<AgentMessage, "id">),
  }));

  return { session, messages };
}

/**
 * Lists sessions for an agent, ordered newest first (by lastMessageAt desc).
 */
export async function listSessions(
  ctx: AgentCtx,
  agentId: string,
  q: ListSessionsQuery = {},
): Promise<{ items: AgentSession[]; nextCursor: string | null }> {
  // Verifies the agent belongs to the organization
  await getAgent(ctx, agentId);

  return sessionRepo.list(ctx.organizationId, {
    where: [["agentId", "==", agentId]],
    orderBy: ["lastMessageAt", "desc"],
    limit: q.limit ?? 20,
    cursor: q.cursor,
  });
}

/**
 * Marks a session as escalated to a human.
 */
export async function markEscalated(
  ctx: AgentCtx,
  sessionId: string,
  reason: string,
): Promise<void> {
  // Enforces cross-org boundary
  const session = await sessionRepo.get(ctx.organizationId, sessionId);
  if (!session) throw new NotFoundError();

  await sessionRepo.update(ctx.organizationId, sessionId, {
    status: "escalated",
    escalationReason: reason,
  });
}
