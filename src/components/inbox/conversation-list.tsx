"use client";

import { MessageSquare, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { INBOX_FILTER_TABS } from "@/config/inbox-labels";
import type { Conversation, ConversationStatus } from "@/schemas/inbox";

import { ConversationCard } from "./conversation-card";

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
  const hasFilters = Boolean(searchQuery.trim()) || statusFilter !== "all";

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Search & Filters Header */}
      <div className="p-3.5 border-b border-border/60 space-y-3">
        <div className="relative">
          <Search
            className="size-4 text-muted-foreground absolute left-3 top-2.5 pointer-events-none"
            aria-hidden="true"
          />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name or phone..."
            aria-label="Search conversations"
            className="pl-9 pr-8 h-9 text-xs bg-background"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        {/* Filter Pills */}
        <div
          className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none"
          role="tablist"
          aria-label="Filter conversations by status"
        >
          {INBOX_FILTER_TABS.map((tab) => {
            const isActive = statusFilter === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onStatusFilterChange(tab.value)}
                className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap font-medium transition-colors cursor-pointer ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
          <span>
            {isLoading
              ? "Loading threads..."
              : `Showing ${conversations.length} thread${conversations.length === 1 ? "" : "s"}`}
          </span>
          {hasFilters ? (
            <button
              type="button"
              onClick={() => {
                onStatusFilterChange("all");
                onSearchChange("");
              }}
              className="text-primary hover:underline cursor-pointer font-medium"
            >
              Reset
            </button>
          ) : null}
        </div>
      </div>

      {/* Conversations Scroll Container */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {isLoading ? (
          <div className="space-y-2 p-1" role="status" aria-label="Loading conversations">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-56 text-center px-4">
            <div className="size-10 rounded-full bg-muted flex items-center justify-center mb-3">
              <MessageSquare className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">No conversations found</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-56">
              {hasFilters
                ? "Try clearing your search or switching status filters."
                : "Incoming WhatsApp and customer messages will appear here."}
            </p>
            {hasFilters ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 text-xs"
                onClick={() => {
                  onStatusFilterChange("all");
                  onSearchChange("");
                }}
              >
                Clear filters
              </Button>
            ) : null}
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
