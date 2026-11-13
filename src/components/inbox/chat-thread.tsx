"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  Copy,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Send,
  Sparkles,
  User,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { ChannelBadge, StatusBadge } from "@/components/inbox/conversation-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { QUICK_REPLY_TEMPLATES, formatMessageDayGroup } from "@/config/inbox-labels";
import { initialsFor } from "@/lib/initials";
import type { Conversation, InboxMessage } from "@/schemas/inbox";

function formatMessageTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}

export function ChatThread({
  conversation,
  messages,
  isLoading,
  canWrite,
  onSendMessage,
  onUpdateStatus,
  isSending,
  isUpdating,
  showDetails,
  onToggleDetails,
  onBackToList,
}: {
  conversation: Conversation | null;
  messages: InboxMessage[];
  isLoading: boolean;
  canWrite: boolean;
  onSendMessage: (text: string) => Promise<void>;
  onUpdateStatus: (patch: { status?: Conversation["status"] }) => Promise<void>;
  isSending: boolean;
  isUpdating?: boolean;
  showDetails?: boolean;
  onToggleDetails?: () => void;
  onBackToList?: () => void;
}) {
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, conversation?.id]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isSending || !canWrite) return;
    setInputText("");
    await onSendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleCopyPhone = (phone: string) => {
    void navigator.clipboard.writeText(phone);
    toast.success("Phone number copied");
  };

  if (!conversation) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-muted/20">
        <div className="size-12 rounded-2xl bg-card border border-border/60 shadow-xs flex items-center justify-center mb-3">
          <Bot className="size-6 text-muted-foreground" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">Select a conversation</h3>
        <p className="text-xs text-muted-foreground max-w-sm mt-1">
          Choose a thread from the left panel to review chat history, monitor AI replies, or take over manually.
        </p>
      </div>
    );
  }

  const isAiActive = conversation.status === "ai_handling";
  const initials = initialsFor(conversation.contactName, null);

  return (
    <div className="flex flex-col h-full bg-muted/20">
      {/* Thread Header */}
      <div className="px-4 sm:px-5 py-3 border-b border-border/60 bg-card flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {onBackToList ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onBackToList}
              className="md:hidden shrink-0"
              aria-label="Back to conversations"
            >
              <ArrowLeft className="size-4" />
            </Button>
          ) : null}

          <div className="size-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-primary">{initials}</span>
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {conversation.contactName}
              </h3>
              <StatusBadge status={conversation.status} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <button
                type="button"
                onClick={() => handleCopyPhone(conversation.contactPhoneE164)}
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors tabular-nums cursor-pointer"
                title="Copy phone number"
              >
                <span>{conversation.contactPhoneE164}</span>
                <Copy className="size-3" />
              </button>
              <span aria-hidden="true">·</span>
              <ChannelBadge channel={conversation.channel} />
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {canWrite ? (
            <>
              {isAiActive ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isUpdating}
                  onClick={() => void onUpdateStatus({ status: "human_handling" })}
                  className="text-xs h-8 gap-1.5"
                >
                  <User className="size-3.5 text-sky-600 dark:text-sky-400" />
                  Take Over
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isUpdating}
                  onClick={() => void onUpdateStatus({ status: "ai_handling" })}
                  className="text-xs h-8 gap-1.5 border-violet-500/30 text-violet-700 dark:text-violet-300 hover:bg-violet-500/10"
                >
                  <Sparkles className="size-3.5" />
                  Hand to AI
                </Button>
              )}

              {conversation.status === "resolved" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isUpdating}
                  onClick={() => void onUpdateStatus({ status: "needs_reply" })}
                  className="text-xs h-8 gap-1.5"
                >
                  <RotateCcw className="size-3.5" />
                  Reopen
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isUpdating}
                  onClick={() => void onUpdateStatus({ status: "resolved" })}
                  className="text-xs h-8 gap-1.5 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                >
                  <CheckCircle2 className="size-3.5" />
                  Resolve
                </Button>
              )}
            </>
          ) : null}

          {onToggleDetails ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onToggleDetails}
              aria-label={showDetails ? "Hide customer details" : "Show customer details"}
              title={showDetails ? "Hide customer details" : "Show customer details"}
              className="hidden lg:inline-flex"
            >
              {showDetails ? (
                <PanelRightClose className="size-4" />
              ) : (
                <PanelRightOpen className="size-4" />
              )}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Messages Scroll Viewport */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
        {isLoading && messages.length === 0 ? (
          <div className="space-y-4" role="status" aria-label="Loading messages">
            <Skeleton className="h-14 w-2/3 rounded-2xl" />
            <Skeleton className="h-16 w-2/3 ml-auto rounded-2xl" />
            <Skeleton className="h-12 w-1/2 rounded-2xl" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-xs text-muted-foreground">
            No messages recorded in this conversation yet.
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isInbound = msg.direction === "inbound";
            const isAgent = msg.sender === "agent";
            const isSystem = msg.type === "system" || msg.sender === "system";
            const dayLabel = formatMessageDayGroup(msg.createdAt);
            const prevDayLabel = idx > 0 ? formatMessageDayGroup(messages[idx - 1]!.createdAt) : "";
            const showDateDivider = dayLabel && dayLabel !== prevDayLabel;

            return (
              <div key={msg.id} className="space-y-3">
                {showDateDivider ? (
                  <div className="flex items-center justify-center my-2">
                    <span className="rounded-full border border-border/60 bg-card px-3 py-0.5 text-[11px] font-medium text-muted-foreground shadow-2xs">
                      {dayLabel}
                    </span>
                  </div>
                ) : null}

                {isSystem ? (
                  <div className="flex justify-center">
                    <span className="rounded-lg bg-muted px-3 py-1 text-[11px] text-muted-foreground text-center max-w-md">
                      {msg.text}
                    </span>
                  </div>
                ) : (
                  <div className={`flex flex-col ${isInbound ? "items-start" : "items-end"} gap-1`}>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground px-1">
                      <span className="font-medium text-foreground/80">{msg.senderName}</span>
                      {isAgent ? (
                        <span className="inline-flex items-center gap-0.5 text-violet-600 dark:text-violet-400 font-medium">
                          <Sparkles className="size-3" />
                          AI
                        </span>
                      ) : null}
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{formatMessageTime(msg.createdAt)}</span>
                    </div>

                    <div
                      className={`max-w-[82%] sm:max-w-[72%] rounded-2xl px-4 py-2.5 text-xs sm:text-[13px] leading-relaxed shadow-xs ${
                        msg.status === "failed"
                          ? "bg-destructive/10 border border-destructive/40 text-foreground rounded-tr-sm"
                          : isInbound
                            ? "bg-card border border-border/70 text-foreground rounded-tl-sm"
                            : isAgent
                              ? "bg-violet-500/10 dark:bg-violet-500/15 border border-violet-500/25 text-foreground rounded-tr-sm"
                              : "bg-primary text-primary-foreground rounded-tr-sm"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{msg.text}</p>

                      {isAgent && Boolean(msg.aiMetadata?.toolCalls) ? (
                        <div className="mt-2 pt-1.5 border-t border-violet-500/20 flex items-center gap-1.5 text-[11px] text-violet-700 dark:text-violet-300">
                          <Wrench className="size-3 shrink-0" />
                          <span>Grounded on live catalog & order tools</span>
                        </div>
                      ) : null}

                      {msg.status === "failed" && msg.errorMessage ? (
                        <p className="mt-1.5 text-[11px] text-destructive font-medium">
                          Delivery failed: {msg.errorMessage}
                        </p>
                      ) : null}

                      {!isInbound ? (
                        <div className="flex justify-end items-center gap-1 mt-1 text-[10px] opacity-75">
                          {msg.status === "received" || msg.status === "sent" ? (
                            <Check className="size-3" />
                          ) : msg.status === "delivered" ? (
                            <CheckCheck className="size-3" />
                          ) : msg.status === "read" ? (
                            <CheckCheck className="size-3 text-sky-400 dark:text-sky-300" />
                          ) : msg.status === "failed" ? (
                            <AlertCircle className="size-3 text-destructive" />
                          ) : (
                            <Clock className="size-3" />
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply Composer */}
      <div className="p-3.5 sm:p-4 border-t border-border/60 bg-card space-y-2.5">
        {isAiActive ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/25 text-violet-700 dark:text-violet-300 text-xs">
            <AlertCircle className="size-4 shrink-0" />
            <span>AI is currently active on this thread. Sending a reply switches control to staff.</span>
          </div>
        ) : null}

        {canWrite ? (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            <span className="text-[11px] font-medium text-muted-foreground shrink-0 mr-1">
              Quick replies:
            </span>
            {QUICK_REPLY_TEMPLATES.map((tpl) => (
              <button
                key={tpl.label}
                type="button"
                onClick={() =>
                  setInputText((prev) => (prev.trim() ? `${prev.trim()}\n${tpl.text}` : tpl.text))
                }
                className="rounded-full border border-border/70 bg-muted/50 hover:bg-muted px-2.5 py-1 text-[11px] font-medium text-foreground whitespace-nowrap transition-colors cursor-pointer"
              >
                {tpl.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="relative flex items-end gap-2">
          <Textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!canWrite || isSending}
            maxLength={4096}
            placeholder={
              canWrite
                ? "Write a reply... (Enter to send, Shift+Enter for new line)"
                : "View-only access. You cannot send replies."
            }
            className="min-h-16 max-h-36 resize-none text-xs sm:text-sm bg-background focus-visible:ring-ring"
          />
          <Button
            type="button"
            size="icon"
            onClick={() => void handleSend()}
            disabled={!inputText.trim() || isSending || !canWrite}
            aria-label="Send message"
            className="size-10 shrink-0"
          >
            <Send className="size-4" />
          </Button>
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
          <span>Enter sends · Shift+Enter adds newline</span>
          <span className="tabular-nums">{inputText.length} / 4096</span>
        </div>
      </div>
    </div>
  );
}
