"use client";

import { useEffect, useRef, useState } from "react";
import { FlaskConical, Send, Square } from "lucide-react";

import { MessageBubble } from "@/components/agents/console/message-bubble";
import { LiveStatus, useAnnouncer } from "@/components/shared/live-status";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ConsoleMessage } from "@/lib/agents/console-state";

interface ChatPaneProps {
  messages: ConsoleMessage[];
  isStreaming: boolean;
  selectedMessageId: string | null;
  onSelectMessage: (id: string) => void;
  onSendMessage: (text: string) => void;
  onStopStreaming: () => void;
  disabled?: boolean;
}

export function ChatPane({
  messages,
  isStreaming,
  selectedMessageId,
  onSelectMessage,
  onSendMessage,
  onStopStreaming,
  disabled,
}: ChatPaneProps) {
  const [text, setText] = useState("");
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { message: announcement, announce } = useAnnouncer();

  // Scroll to bottom on messages update
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  // Announce completed assistant message to screen readers
  useEffect(() => {
    if (!isStreaming && messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last && last.role === "assistant" && last.text) {
        announce(`Agent replied: ${last.text.slice(0, 100)}`);
      }
    }
  }, [isStreaming, messages, announce]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming || disabled) return;
    setText("");
    onSendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <LiveStatus message={announcement} />

      {/* Persistent Test Mode Banner */}
      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
        <FlaskConical className="h-4 w-4 shrink-0 text-primary" />
        <span>Test mode: nothing the agent does here changes real data.</span>
      </div>

      {/* Transcript */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground">
            <FlaskConical className="h-10 w-10 mb-3 opacity-30" />
            <h3 className="text-base font-medium text-foreground">Test Console Ready</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Send a customer enquiry in Bangla, English, or Banglish to see real-time tool calling and dry-run responses.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              isSelected={m.id === selectedMessageId}
              onSelect={() => onSelectMessage(m.id)}
              isStreaming={isStreaming && m.id === messages[messages.length - 1]?.id}
            />
          ))
        )}
      </div>

      {/* Composer */}
      <div className="border-t bg-background p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message (Enter to send, Shift+Enter for new line)..."
            rows={1}
            disabled={disabled}
            className="min-h-[44px] resize-none text-sm"
          />

          {isStreaming ? (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              onClick={onStopStreaming}
              aria-label="Stop generation"
              className="h-11 w-11 shrink-0"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={handleSend}
              disabled={disabled || !text.trim()}
              aria-label="Send message"
              className="h-11 w-11 shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
