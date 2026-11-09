"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  Check,
  CheckCheck,
  Clock,
  Send,
  Sparkles,
  User,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/inbox/conversation-card";
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
}: {
  conversation: Conversation | null;
  messages: InboxMessage[];
  isLoading: boolean;
  canWrite: boolean;
  onSendMessage: (text: string) => Promise<void>;
  onUpdateStatus: (patch: { status?: Conversation["status"] }) => Promise<void>;
  isSending: boolean;
}) {
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isSending || !canWrite) return;
    setInputText("");
    await onSendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (!conversation) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-background/50">
        <Bot className="w-12 h-12 text-muted-foreground/30 mb-3" />
        <h3 className="text-sm font-semibold text-foreground">Select a conversation</h3>
        <p className="text-xs text-muted-foreground max-w-sm mt-1">
          Choose a conversation from the list to view chat history and reply directly.
        </p>
      </div>
    );
  }

  const isAiActive = conversation.status === "ai_handling";

  return (
    <div className="flex flex-col h-full bg-background/40">
      {/* Thread Header */}
      <div className="px-5 py-3 border-b border-border/50 bg-card/60 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <span className="text-sm font-bold text-primary">
              {conversation.contactName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground truncate">
                {conversation.contactName}
              </h3>
              <StatusBadge status={conversation.status} />
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {conversation.contactPhoneE164} · WhatsApp
            </p>
          </div>
        </div>

        {/* Action Controls */}
        {canWrite && (
          <div className="flex items-center gap-2 shrink-0">
            {isAiActive ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onUpdateStatus({ status: "human_handling" })}
                className="text-xs h-8 gap-1.5 border-border hover:bg-accent"
              >
                <User className="w-3.5 h-3.5 text-blue-400" />
                Take Over
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onUpdateStatus({ status: "ai_handling" })}
                className="text-xs h-8 gap-1.5 border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                Hand to AI
              </Button>
            )}

            {conversation.status === "resolved" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onUpdateStatus({ status: "needs_reply" })}
                className="text-xs h-8"
              >
                Reopen
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onUpdateStatus({ status: "resolved" })}
                className="text-xs h-8 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10"
              >
                Resolve
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Messages Scroll Viewport */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {isLoading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
            Loading messages...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-xs text-muted-foreground">
            No messages recorded in this conversation yet.
          </div>
        ) : (
          messages.map((msg) => {
            const isInbound = msg.direction === "inbound";
            const isAgent = msg.sender === "agent";

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isInbound ? "items-start" : "items-end"} gap-1`}
              >
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground px-1">
                  <span>{msg.senderName}</span>
                  {isAgent && (
                    <span className="flex items-center gap-0.5 text-purple-400 font-medium">
                      <Sparkles className="w-3 h-3" />
                      AI
                    </span>
                  )}
                  <span>·</span>
                  <span>{formatMessageTime(msg.createdAt)}</span>
                </div>

                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-sm ${
                    isInbound
                      ? "bg-card border border-border/60 text-foreground rounded-tl-sm"
                      : isAgent
                        ? "bg-purple-950/20 border border-purple-500/30 text-purple-100 rounded-tr-sm"
                        : "bg-primary text-primary-foreground rounded-tr-sm font-medium"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.text}</p>

                  {/* AI Tool calls inspector pill */}
                  {isAgent && Boolean(msg.aiMetadata?.toolCalls) && (
                    <div className="mt-2 pt-1.5 border-t border-purple-500/20 flex items-center gap-1.5 text-[10px] text-purple-300">
                      <Wrench className="w-3 h-3" />
                      <span>Grounded on real catalog tools</span>
                    </div>
                  )}

                  {/* Status ticks for outbound messages */}
                  {!isInbound && (
                    <div className="flex justify-end items-center gap-1 mt-1 text-[10px] opacity-75">
                      {msg.status === "received" || msg.status === "sent" ? (
                        <Check className="w-3 h-3" />
                      ) : msg.status === "delivered" ? (
                        <CheckCheck className="w-3 h-3" />
                      ) : msg.status === "read" ? (
                        <CheckCheck className="w-3 h-3 text-cyan-300" />
                      ) : (
                        <Clock className="w-3 h-3" />
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply Composer */}
      <div className="p-4 border-t border-border/50 bg-card/40 space-y-2">
        {isAiActive && (
          <div className="flex items-center gap-2 p-2 px-3 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 text-purple-400" />
            <span>AI is currently active. Replying will switch control to human staff.</span>
          </div>
        )}

        <div className="relative flex items-end gap-2">
          <Textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!canWrite || isSending}
            placeholder={
              canWrite
                ? "Type a reply... (Ctrl + Enter to send)"
                : "View-only access. You cannot reply."
            }
            className="min-h-16 resize-none text-xs bg-background/60 pr-12 focus-visible:ring-primary"
          />
          <Button
            type="button"
            size="icon"
            onClick={() => void handleSend()}
            disabled={!inputText.trim() || isSending || !canWrite}
            className="h-9 w-9 shrink-0 mb-1.5 bg-primary hover:bg-primary/90"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
