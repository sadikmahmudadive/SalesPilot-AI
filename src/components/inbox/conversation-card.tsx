"use client";

import { MessageSquare, Phone, Sparkles, User, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { Conversation, ConversationStatus } from "@/schemas/inbox";

function formatRelativeTime(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(isoString).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function StatusBadge({ status }: { status: ConversationStatus }) {
  switch (status) {
    case "ai_handling":
      return (
        <Badge variant="outline" className="border-purple-500/40 bg-purple-500/10 text-purple-400 gap-1 text-[11px] font-medium py-0">
          <Sparkles className="w-3 h-3 text-purple-400" />
          AI Active
        </Badge>
      );
    case "needs_reply":
      return (
        <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-400 gap-1 text-[11px] font-medium py-0">
          <MessageSquare className="w-3 h-3 text-amber-400" />
          Needs Reply
        </Badge>
      );
    case "human_handling":
      return (
        <Badge variant="outline" className="border-blue-500/40 bg-blue-500/10 text-blue-400 gap-1 text-[11px] font-medium py-0">
          <User className="w-3 h-3 text-blue-400" />
          Human Active
        </Badge>
      );
    case "resolved":
      return (
        <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400 gap-1 text-[11px] font-medium py-0">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          Resolved
        </Badge>
      );
  }
}

export function ConversationCard({
  conversation,
  isSelected,
  onClick,
}: {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
}) {
  const lastMsg = conversation.lastMessage;
  const timeText = lastMsg ? formatRelativeTime(lastMsg.at) : formatRelativeTime(conversation.lastActivityAt);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-3.5 rounded-lg border transition-all flex flex-col gap-2 ${
        isSelected
          ? "bg-accent/40 border-primary/50 shadow-sm"
          : "bg-card/30 hover:bg-accent/20 border-border/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-primary">
              {conversation.contactName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold truncate text-foreground leading-tight">
              {conversation.contactName}
            </h4>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
              <Phone className="w-3 h-3 shrink-0" />
              <span className="truncate">{conversation.contactPhoneE164}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end shrink-0 gap-1">
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">{timeText}</span>
          {conversation.unreadCount > 0 && (
            <span className="px-1.5 py-0.2 bg-primary text-primary-foreground text-[10px] font-bold rounded-full min-w-4 text-center">
              {conversation.unreadCount}
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground line-clamp-1 italic">
        {lastMsg?.text || "No messages yet"}
      </p>

      <div className="flex items-center justify-between mt-0.5 pt-1 border-t border-border/30">
        <div className="flex items-center gap-1 text-[11px] text-emerald-500 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          WhatsApp
        </div>
        <StatusBadge status={conversation.status} />
      </div>
    </button>
  );
}
