"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { inboxKeys } from "@/hooks/query-keys";
import { apiFetch } from "@/lib/api/client";
import type {
  Conversation,
  ConversationStatus,
  InboxMessage,
  SendMessageInput,
  UpdateConversationInput,
} from "@/schemas/inbox";

export interface ConversationListParams {
  limit?: number;
  cursor?: string;
  status?: ConversationStatus;
  search?: string;
}

export function buildInboxQuery(params: ConversationListParams): string {
  const p = new URLSearchParams();
  if (params.limit !== undefined) p.set("limit", String(params.limit));
  if (params.cursor) p.set("cursor", params.cursor);
  if (params.status) p.set("status", params.status);
  if (params.search) p.set("search", params.search);
  const str = p.toString();
  return str ? `?${str}` : "";
}

export function useConversations(params: ConversationListParams = {}) {
  return useQuery({
    queryKey: inboxKeys.conversationList(params),
    queryFn: ({ signal }) =>
      apiFetch<{ items: Conversation[]; nextCursor: string | null }>(
        `/api/inbox/conversations${buildInboxQuery(params)}`,
        { signal },
      ),
    refetchInterval: 5000,
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: id ? inboxKeys.conversationDetail(id) : ["inbox", "conversation", "none"],
    queryFn: ({ signal }) =>
      apiFetch<Conversation>(`/api/inbox/conversations/${encodeURIComponent(id!)}`, { signal }),
    enabled: Boolean(id),
    refetchInterval: 5000,
  });
}

export function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: conversationId ? inboxKeys.messages(conversationId) : ["inbox", "messages", "none"],
    queryFn: ({ signal }) =>
      apiFetch<{ items: InboxMessage[]; nextCursor: string | null }>(
        `/api/inbox/conversations/${encodeURIComponent(conversationId!)}/messages?limit=100`,
        { signal },
      ),
    enabled: Boolean(conversationId),
    refetchInterval: 3000,
  });
}

export function useSendMessage(conversationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SendMessageInput) => {
      if (!conversationId) throw new Error("No conversation selected");
      return apiFetch<InboxMessage>(
        `/api/inbox/conversations/${encodeURIComponent(conversationId)}/messages`,
        { method: "POST", body },
      );
    },
    onSuccess: () => {
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: inboxKeys.messages(conversationId) });
        queryClient.invalidateQueries({ queryKey: inboxKeys.conversationDetail(conversationId) });
      }
      queryClient.invalidateQueries({ queryKey: inboxKeys.conversations() });
    },
  });
}

export function useUpdateConversation(id: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateConversationInput) => {
      if (!id) throw new Error("No conversation selected");
      return apiFetch<Conversation>(
        `/api/inbox/conversations/${encodeURIComponent(id)}`,
        { method: "PATCH", body },
      );
    },
    onSuccess: () => {
      if (id) {
        queryClient.invalidateQueries({ queryKey: inboxKeys.conversationDetail(id) });
      }
      queryClient.invalidateQueries({ queryKey: inboxKeys.conversations() });
    },
  });
}
