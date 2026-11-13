"use client";

import { CheckCircle2, MessageSquare, Phone, Sparkles, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  conversationChannelLabel,
  conversationStatusLabel,
  formatRelativeActivity,
} from "@/config/inbox-labels";
import { initialsFor } from "@/lib/initials";
import type { Conversation, ConversationChannel, ConversationStatus } from "@/schemas/inbox";

const STATUS_STYLE: Readonly<Record<ConversationStatus, string>> = {
  ai_handling:
    "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  needs_reply:
    "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  human_handling:
    "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  resolved:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

const CHANNEL_DOT: Readonly<Record<ConversationChannel, string>> = {
  whatsapp: "bg-emerald-500",
  messenger: "bg-sky-500",
  instagram: "bg-pink-500",
  email: "bg-amber-500",
};

export function StatusBadge({ status }: { status: ConversationStatus }) {
  const Icon =
    status === "ai_handling"
      ? Sparkles
      : status === "needs_reply"
        ? MessageSquare
        : status === "human_handling"
          ? User
          : CheckCircle2;

  return (
    <Badge
      variant="outline"
      className={`gap-1 rounded-full px-2 py-0 text-[11px] font-medium ${STATUS_STYLE[status]}`}
    >
      <Icon className="size-3 shrink-0" />
      {conversationStatusLabel(status)}
    </Badge>
  );
}

export function ChannelBadge({ channel }: { channel: ConversationChannel }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <span className={`size-2 rounded-full shrink-0 ${CHANNEL_DOT[channel]}`} aria-hidden="true" />
      {conversationChannelLabel(channel)}
    </span>
  );
}

function previewPrefix(conv: Conversation): string {
  const last = conv.lastMessage;
  if (!last) return "No messages yet";
  const prefix =
    last.sender === "agent" ? "AI: " : last.sender === "user" ? "You: " : "";
  return `${prefix}${last.text}`;
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
  const timeText = lastMsg
    ? formatRelativeActivity(lastMsg.at)
    : formatRelativeActivity(conversation.lastActivityAt);
  const hasUnread = conversation.unreadCount > 0;
  const initials = initialsFor(conversation.contactName, null);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isSelected ? "true" : undefined}
      className={`group relative w-full text-left rounded-xl border p-3 transition-all flex flex-col gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        isSelected
          ? "bg-accent border-primary/40 shadow-sm"
          : "bg-background/60 border-border/50 hover:bg-accent/50 hover:border-border"
      }`}
    >
      {isSelected && (
        <span
          aria-hidden="true"
          className="absolute inset-y-2.5 left-0 w-1 rounded-r-full bg-primary"
        />
      )}

      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`size-9 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold ${
              isSelected
                ? "bg-primary text-primary-foreground"
                : "bg-primary/10 text-primary border border-primary/20"
            }`}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold truncate text-foreground leading-snug">
              {conversation.contactName}
            </h4>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5 tabular-nums">
              <Phone className="size-3 shrink-0" />
              <span className="truncate">{conversation.contactPhoneE164}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end shrink-0 gap-1">
          <span className="text-[11px] text-muted-foreground whitespace-nowrap tabular-nums">
            {timeText}
          </span>
          {hasUnread ? (
            <span className="inline-flex items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground tabular-nums min-w-5">
              {conversation.unreadCount}
            </span>
          ) : null}
        </div>
      </div>

      <p
        className={`text-xs line-clamp-1 ${
          hasUnread ? "font-medium text-foreground" : "text-muted-foreground"
        }`}
      >
        {previewPrefix(conversation)}
      </p>

      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-border/40">
        <ChannelBadge channel={conversation.channel} />
        <StatusBadge status={conversation.status} />
      </div>
    </button>
  );
}
