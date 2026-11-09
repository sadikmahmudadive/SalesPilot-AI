"use client";

import { MessageSquare, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Conversation, ConversationStatus } from "@/schemas/inbox";

import { ConversationCard } from "./conversation-card";

const FILTER_TABS: Array<{ label: string; value: ConversationStatus | "all" }> = [
  { label: "All", value: "all" },
  { label: "Needs Reply", value: "needs_reply" },
  { label: "AI Active", value: "ai_handling" },
  { label: "Human", value: "human_handling" },
  { label: "Resolved", value: "resolved" },
];

export function ConversationList({
  conversations,
  isLoading,
  selectedId,
  onSelect,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchChange,
}: {
  conversations: Conversation[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  statusFilter: ConversationStatus | "all";
  onStatusFilterChange: (s: ConversationStatus | "all") => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}) {
  return (
    <div className="flex flex-col h-full bg-card border-r border-border/50">
      {/* Search Header */}
      <div className="p-3.5 border-b border-border/40 space-y-2.5">
        <div className="relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-2.5" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search conversations..."
            className="pl-9 h-9 text-xs bg-background/50"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
          {FILTER_TABS.map((tab) => {
            const isActive = statusFilter === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => onStatusFilterChange(tab.value)}
                className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversations Scroll Container */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {isLoading ? (
          <div className="space-y-2 p-1">
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center p-4">
            <MessageSquare className="w-8 h-8 text-muted-foreground/40 mb-2" />
            <p className="text-xs font-medium text-foreground">No conversations found</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {searchQuery || statusFilter !== "all"
                ? "Try adjusting your filters or search term"
                : "Customer chats from WhatsApp will appear here"}
            </p>
          </div>
        ) : (
          conversations.map((conv) => (
            <ConversationCard
              key={conv.id}
              conversation={conv}
              isSelected={conv.id === selectedId}
              onClick={() => onSelect(conv.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
