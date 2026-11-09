"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  useConversation,
  useConversations,
  useMessages,
  useSendMessage,
  useUpdateConversation,
} from "@/hooks/use-inbox";
import type { ConversationStatus } from "@/schemas/inbox";

import { ChatThread } from "./chat-thread";
import { ConversationList } from "./conversation-list";
import { CustomerSidebar } from "./customer-sidebar";

export function InboxShell({ canWrite }: { canWrite: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const queryParams = useMemo(() => {
    return {
      status: statusFilter === "all" ? undefined : statusFilter,
      search: searchQuery.trim() || undefined,
    };
  }, [statusFilter, searchQuery]);

  const { data: convData, isLoading: isLoadingList } = useConversations(queryParams);
  const conversations = convData?.items ?? [];

  // Automatically select first conversation if none selected
  const activeId = selectedId ?? conversations[0]?.id ?? null;

  const { data: activeConv } = useConversation(activeId);
  const { data: messagesData, isLoading: isLoadingMessages } = useMessages(activeId);
  const messages = messagesData?.items ?? [];

  const sendMutation = useSendMessage(activeId);
  const updateMutation = useUpdateConversation(activeId);

  const handleSendMessage = async (text: string) => {
    try {
      await sendMutation.mutateAsync({ text });
    } catch {
      toast.error("Failed to send message. Please try again.");
    }
  };

  const handleUpdateStatus = async (patch: { status?: ConversationStatus }) => {
    try {
      await updateMutation.mutateAsync(patch);
      toast.success("Conversation updated");
    } catch {
      toast.error("Failed to update conversation");
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden border border-border/40 rounded-xl bg-card shadow-sm">
      {/* Left Column: Conversations List (fixed width 320px) */}
      <div className="w-80 shrink-0 h-full">
        <ConversationList
          conversations={conversations}
          isLoading={isLoadingList}
          selectedId={activeId}
          onSelect={setSelectedId}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      </div>

      {/* Center Column: Active Chat Thread (flex-1) */}
      <div className="flex-1 h-full min-w-0">
        <ChatThread
          conversation={activeConv ?? null}
          messages={messages}
          isLoading={isLoadingMessages}
          canWrite={canWrite}
          onSendMessage={handleSendMessage}
          onUpdateStatus={handleUpdateStatus}
          isSending={sendMutation.isPending}
        />
      </div>

      {/* Right Column: Customer & CRM Info Sidebar */}
      {activeConv && <CustomerSidebar conversation={activeConv} />}
    </div>
  );
}
