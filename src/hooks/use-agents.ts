"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentKeys } from "@/hooks/query-keys";
import { usePagedList, type Page } from "@/hooks/use-paged-list";
import { ApiError, apiFetch } from "@/lib/api/client";
import type { Agent, AgentInput, AgentPatch } from "@/schemas/agent";

export interface AgentListParams {
  limit?: number;
  cursor?: string;
}

export type AgentListPage = Page<Agent>;

export function buildAgentsQuery(params: AgentListParams): URLSearchParams {
  const out = new URLSearchParams();
  if (params.limit !== undefined) out.set("limit", String(params.limit));
  if (params.cursor) out.set("cursor", params.cursor);
  return out;
}

export function useAgents(params: Omit<AgentListParams, "cursor"> = {}) {
  return usePagedList<Agent, Omit<AgentListParams, "cursor">>(
    agentKeys.list(params),
    "/api/agents",
    params,
    buildAgentsQuery,
  );
}

export function useAgent(id: string | undefined) {
  return useQuery({
    queryKey: id ? agentKeys.detail(id) : ["agents", "detail", "empty"],
    queryFn: ({ signal }) =>
      apiFetch<Agent>(`/api/agents/${encodeURIComponent(id!)}`, { signal }),
    enabled: Boolean(id),
    retry: (count, error) =>
      !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AgentInput) =>
      apiFetch<Agent>("/api/agents", { method: "POST", body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useUpdateAgent(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AgentPatch) =>
      apiFetch<Agent>(`/api/agents/${encodeURIComponent(id)}`, { method: "PATCH", body }),
    onSuccess: (updated) => {
      queryClient.setQueryData(agentKeys.detail(id), updated);
      queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });
}
