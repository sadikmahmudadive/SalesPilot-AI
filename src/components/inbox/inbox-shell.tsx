"use client";

import { useMemo, useState } from "react";
import {
  BellRing,
  Inbox,
  MessageSquareDashed,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  useConversation,
  useConversations,
  useMessages,
  useSendMessage,
  useUpdateConversation,
} from "@/hooks/use-inbox";
import { formatCount } from "@/lib/format";
import type { ConversationStatus } from "@/schemas/inbox";

import { ChatThread } from "./chat-thread";
import { ConversationList } from "./conversation-list";
import { CustomerSidebar } from "./customer-sidebar";

export function InboxShell({ canWrite }: { canWrite: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showDetails, setShowDetails] = useState(true);
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");

  const debouncedSearch = useDebouncedValue(searchQuery.trim(), 250);

  const queryParams = useMemo(() => {
    return {
      status: statusFilter === "all" ? undefined : statusFilter,
      search: debouncedSearch || undefined,
    };
  }, [statusFilter, debouncedSearch]);

  const {
    data: convData,
    isLoading: isLoadingList,
    isFetching: isFetchingList,
    refetch: refetchList,
  } = useConversations(queryParams);
  const conversations = useMemo(() => convData?.items ?? [], [convData]);

  // Automatically select first conversation if none selected or active one is no longer visible.
  const activeId = selectedId ?? conversations[0]?.id ?? null;

  const { data: activeConv, refetch: refetchConv } = useConversation(activeId);
  const {
    data: messagesData,
    isLoading: isLoadingMessages,
    refetch: refetchMessages,
  } = useMessages(activeId);
  const messages = messagesData?.items ?? [];

  const sendMutation = useSendMessage(activeId);
  const updateMutation = useUpdateConversation(activeId);

  const stats = useMemo(() => {
    let needsReply = 0;
    let aiHandling = 0;
    let unread = 0;
    for (const c of conversations) {
      if (c.status === "needs_reply") needsReply += 1;
      else if (c.status === "ai_handling") aiHandling += 1;
      if (c.unreadCount > 0) unread += 1;
    }
    return {
      total: conversations.length,
      needsReply,
      aiHandling,
      unread,
    };
  }, [conversations]);

  const handleSelectConversation = (id: string) => {
    setSelectedId(id);
    setMobileView("thread");
  };

  const handleRefreshAll = () => {
    void refetchList();
    if (activeId) {
      void refetchConv();
      void refetchMessages();
    }
  };

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
    <div className="space-y-5">
      <PageHeader
        title="Unified Inbox"
        description="Manage customer chats, monitor AI agent replies, and hand off conversations in real time."
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRefreshAll}
              disabled={isFetchingList}
            >
              <RefreshCw className={`size-4 ${isFetchingList ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {activeConv ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowDetails((prev) => !prev)}
                className="hidden lg:inline-flex"
              >
                {showDetails ? (
                  <>
                    <PanelRightClose className="size-4" />
                    Hide details
                  </>
                ) : (
                  <>
                    <PanelRightOpen className="size-4" />
                    Customer details
                  </>
                )}
              </Button>
            ) : null}
          </div>
        }
      />

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card size="sm">
          <CardContent className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">Threads in View</p>
              <p className="text-xl font-semibold tabular-nums mt-0.5">
                {formatCount(stats.total)}
              </p>
            </div>
            <Inbox className="size-4 text-muted-foreground shrink-0" />
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">Needs Reply</p>
              <p className="text-xl font-semibold tabular-nums mt-0.5 text-amber-600 dark:text-amber-400">
                {formatCount(stats.needsReply)}
              </p>
            </div>
            <MessageSquareDashed className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">AI Active</p>
              <p className="text-xl font-semibold tabular-nums mt-0.5 text-violet-600 dark:text-violet-400">
                {formatCount(stats.aiHandling)}
              </p>
            </div>
            <Sparkles className="size-4 text-violet-600 dark:text-violet-400 shrink-0" />
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">Unread</p>
              <p className="text-xl font-semibold tabular-nums mt-0.5">
                {formatCount(stats.unread)}
              </p>
            </div>
            <BellRing className="size-4 text-muted-foreground shrink-0" />
          </CardContent>
        </Card>
      </div>

      {/* Main Split Workspace */}
      <div className="flex h-[calc(100vh-17.5rem)] min-h-[520px] overflow-hidden border border-border/60 rounded-2xl bg-card shadow-xs">
        {/* Left Column: Conversations List */}
        <div
          className={`${
            mobileView === "list" ? "flex" : "hidden md:flex"
          } w-full md:w-80 lg:w-84 shrink-0 h-full border-r border-border/60 flex-col`}
        >
          <ConversationList
            conversations={conversations}
            isLoading={isLoadingList}
            selectedId={activeId}
            onSelect={handleSelectConversation}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
        </div>

        {/* Center Column: Active Chat Thread */}
        <div
          className={`${
            mobileView === "thread" ? "flex" : "hidden md:flex"
          } flex-1 h-full min-w-0 flex-col`}
        >
          <ChatThread
            conversation={activeConv ?? null}
            messages={messages}
            isLoading={isLoadingMessages}
            canWrite={canWrite}
            onSendMessage={handleSendMessage}
            onUpdateStatus={handleUpdateStatus}
            isSending={sendMutation.isPending}
            isUpdating={updateMutation.isPending}
            showDetails={showDetails}
            onToggleDetails={() => setShowDetails((prev) => !prev)}
            onBackToList={() => setMobileView("list")}
          />
        </div>

        {/* Right Column: Customer & CRM Info Sidebar */}
        {activeConv && showDetails ? (
          <div className="hidden lg:flex h-full">
            <CustomerSidebar conversation={activeConv} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
