"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api/client";
import type { AgentMessage, AgentSession } from "@/repositories/agent-sessions";

export const sessionKeys = {
  all: ["agentSessions"] as const,
  list: (agentId: string) => [...sessionKeys.all, "list", agentId] as const,
  detail: (sessionId: string) => [...sessionKeys.all, "detail", sessionId] as const,
};

export interface AgentSessionsResponse {
  items: AgentSession[];
  nextCursor: string | null;
}

export interface AgentSessionDetailResponse {
  session: AgentSession;
  messages: AgentMessage[];
}

export function useAgentSessions(agentId: string | undefined) {
  return useQuery({
    queryKey: agentId ? sessionKeys.list(agentId) : ["agentSessions", "list", "empty"],
    queryFn: ({ signal }) =>
      apiFetch<AgentSessionsResponse>(`/api/agents/${encodeURIComponent(agentId!)}/sessions`, {
        signal,
      }),
    enabled: Boolean(agentId),
  });
}

export function useAgentSession(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: sessionId ? sessionKeys.detail(sessionId) : ["agentSessions", "detail", "empty"],
    queryFn: ({ signal }) =>
      apiFetch<AgentSessionDetailResponse>(
        `/api/agent-sessions/${encodeURIComponent(sessionId!)}`,
        { signal },
      ),
    enabled: Boolean(sessionId),
  });
}

export function useCreateSession(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<AgentSession>(`/api/agents/${encodeURIComponent(agentId)}/sessions`, {
        method: "POST",
      }),
    onSuccess: (newSession) => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list(agentId) });
      queryClient.setQueryData(sessionKeys.detail(newSession.id), {
        session: newSession,
        messages: [],
      });
    },
  });
}
