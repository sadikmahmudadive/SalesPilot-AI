"use client";

import { AlertTriangle, Clock, ShieldAlert, Wrench, Zap } from "lucide-react";

import type { ConsoleMessage, InspectorToolCall } from "@/lib/agents/console-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface InspectorPaneProps {
  message: ConsoleMessage | null;
}

export function InspectorPane({ message }: InspectorPaneProps) {
  if (!message || message.role !== "assistant") {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground">
        <Wrench className="h-8 w-8 mb-2 stroke-[1.5] opacity-40" />
        <h3 className="text-sm font-medium">No turn selected</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">
          Click any assistant message in the chat to inspect its tool calls, dry runs and tokens.
        </p>
      </div>
    );
  }

  const toolCalls = message.toolCalls ?? [];
  const warnings = message.warnings ?? [];
  const usage = message.usage;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wide">Turn Inspector</h2>
          <div className="flex items-center gap-2">
            {message.agentVersion ? (
              <Badge variant="outline" className="text-xs">
                v{message.agentVersion}
              </Badge>
            ) : null}
            {message.latencyMs ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {message.latencyMs}ms
              </span>
            ) : null}
          </div>
        </div>

        {usage ? (
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Zap className="h-3 w-3 text-amber-500" />
              {usage.inputTokens} in / {usage.outputTokens} out tokens
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Warnings */}
        {warnings.length > 0 ? (
          <div className="space-y-2">
            {warnings.map((w, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    {w === "unverified_figure" ? "Unverified Price or Figure" : w}
                  </p>
                  <p className="mt-0.5 opacity-90">
                    A price or number mentioned in the reply was not verified against tool results.
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Tool Calls */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tool Calls ({toolCalls.length})
            </h3>
          </div>

          {toolCalls.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No tools were called during this turn.
            </p>
          ) : (
            <div className="space-y-3">
              {toolCalls.map((tc) => (
                <ToolCallCard key={tc.id} toolCall={tc} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolCallCard({ toolCall }: { toolCall: InspectorToolCall }) {
  const statusVariant =
    toolCall.status === "ok"
      ? "default"
      : toolCall.status === "denied"
        ? "secondary"
        : "destructive";

  return (
    <Card className="border-border/80 text-xs shadow-none">
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="font-mono text-xs font-semibold">
            {toolCall.name}
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {toolCall.durationMs !== undefined ? (
              <span className="text-[10px] text-muted-foreground">
                {toolCall.durationMs}ms
              </span>
            ) : null}
            {toolCall.status ? (
              <Badge variant={statusVariant} className="text-[10px] uppercase px-1.5 py-0">
                {toolCall.status}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] uppercase px-1.5 py-0 animate-pulse">
                running
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-3 pt-0 space-y-2.5">
        {/* Arguments */}
        <div>
          <span className="text-[10px] font-medium text-muted-foreground uppercase">
            Arguments
          </span>
          <pre className="mt-1 overflow-x-auto rounded bg-muted/60 p-2 font-mono text-[11px] leading-tight">
            {JSON.stringify(toolCall.args, null, 2)}
          </pre>
        </div>

        {/* Result Summary */}
        {toolCall.resultSummary ? (
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase">
              Result Summary
            </span>
            <p className="mt-1 rounded bg-muted/30 p-2 text-[11px] text-foreground leading-normal">
              {toolCall.resultSummary}
            </p>
          </div>
        ) : null}

        {/* Dry Run Action */}
        {toolCall.dryRunAction ? (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 space-y-1">
            <div className="flex items-center gap-1.5 text-primary font-medium text-[11px]">
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>Dry Run Action: {toolCall.dryRunAction.kind}</span>
            </div>
            <pre className="overflow-x-auto rounded bg-background/80 p-1.5 font-mono text-[10px] leading-tight">
              {JSON.stringify(toolCall.dryRunAction.fields, null, 2)}
            </pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
