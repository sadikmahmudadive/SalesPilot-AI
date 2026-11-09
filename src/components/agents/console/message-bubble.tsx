"use client";

import { AlertTriangle, Bot, User, Wrench, XCircle } from "lucide-react";

import type { ConsoleMessage } from "@/lib/agents/console-state";
import { Badge } from "@/components/ui/badge";

interface MessageBubbleProps {
  message: ConsoleMessage;
  isSelected?: boolean;
  onSelect?: () => void;
  isStreaming?: boolean;
}

export function MessageBubble({
  message,
  isSelected,
  onSelect,
  isStreaming,
}: MessageBubbleProps) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[85%] items-start gap-2.5 sm:max-w-[75%]">
          <div className="rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm">
            <p className="whitespace-pre-wrap break-words">{message.text}</p>
          </div>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
            <User className="h-4 w-4" />
          </div>
        </div>
      </div>
    );
  }

  const toolCount = message.toolCalls?.length ?? 0;
  const hasWarnings = (message.warnings?.length ?? 0) > 0;

  return (
    <div className="flex justify-start">
      <div className="flex max-w-[90%] items-start gap-2.5 sm:max-w-[80%]">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Bot className="h-4 w-4" />
        </div>

        <div
          onClick={onSelect}
          className={`space-y-2 rounded-2xl border p-4 text-sm transition-all cursor-pointer ${
            isSelected
              ? "border-primary/50 bg-card shadow-sm ring-1 ring-primary/20"
              : "border-border/60 bg-muted/40 hover:bg-muted/70"
          }`}
        >
          {message.error ? (
            <div className="flex items-start gap-2 text-destructive">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">{message.error.message}</p>
                {message.error.code ? (
                  <p className="text-xs opacity-75">Code: {message.error.code}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="whitespace-pre-wrap break-words">
              {message.text}
              {isStreaming ? (
                <span className="inline-block h-3.5 w-1.5 animate-pulse bg-primary ml-1" />
              ) : null}
            </div>
          )}

          {message.interrupted ? (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Response interrupted</span>
            </div>
          ) : null}

          {/* Footer badges & inspector hint */}
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40 text-[11px] text-muted-foreground">
            {toolCount > 0 ? (
              <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
                <Wrench className="h-3 w-3" />
                {toolCount} {toolCount === 1 ? "tool call" : "tool calls"}
              </Badge>
            ) : null}

            {hasWarnings ? (
              <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400 px-1.5 py-0 text-[10px]">
                <AlertTriangle className="h-3 w-3" />
                unverified figure
              </Badge>
            ) : null}

            {message.agentVersion ? (
              <span className="text-muted-foreground/75">v{message.agentVersion}</span>
            ) : null}

            {message.latencyMs ? (
              <span className="text-muted-foreground/75">{message.latencyMs}ms</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
