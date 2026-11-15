"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Bot, PanelRightOpen } from "lucide-react";

import { ChatPane } from "@/components/agents/console/chat-pane";
import { InspectorPane } from "@/components/agents/console/inspector-pane";
import { SessionPicker } from "@/components/agents/console/session-picker";
import { BackLink } from "@/components/shared/back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgent } from "@/hooks/use-agents";
import { useAgentSession, useAgentSessions, useCreateSession } from "@/hooks/use-agent-sessions";
import {
  consoleReducer,
  INITIAL_CONSOLE_STATE,
  type ConsoleMessage,
  type InspectorToolCall,
} from "@/lib/agents/console-state";
import { readSseStream } from "@/lib/agents/sse-client";
import type { Role } from "@/lib/security/permissions";
import type { AgentMessage } from "@/repositories/agent-sessions";

interface TestConsoleProps {
  agentId: string;
  role: Role;
}

export function TestConsole({ agentId }: TestConsoleProps) {
  const agentQuery = useAgent(agentId);
  const agent = agentQuery.data;

  const sessionsQuery = useAgentSessions(agentId);
  const createSessionMutation = useCreateSession(agentId);

  const [userSelectedSessionId, setUserSelectedSessionId] = useState<string | null>(null);
  const activeSessionId = userSelectedSessionId ?? sessionsQuery.data?.items[0]?.id ?? null;

  const [consoleState, dispatch] = useReducer(consoleReducer, INITIAL_CONSOLE_STATE);
  const [aiNotConfigured, setAiNotConfigured] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Load active session messages
  const sessionDetailQuery = useAgentSession(activeSessionId);

  useEffect(() => {
    if (!sessionDetailQuery.data) return;
    const rawMessages: AgentMessage[] = sessionDetailQuery.data.messages;

    const formatted: ConsoleMessage[] = rawMessages.map((m) => {
      const toolCalls: InspectorToolCall[] = (m.toolCalls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
        status: tc.status,
        resultSummary: tc.resultSummary,
        durationMs: tc.durationMs,
        dryRunAction: tc.dryRunAction,
      }));

      return {
        id: m.id ?? crypto.randomUUID(),
        role: m.role,
        text: m.text,
        createdAt: m.createdAt,
        agentVersion: m.agentVersion,
        toolCalls,
        warnings: m.warnings,
        usage: m.usage,
        latencyMs: m.latencyMs,
        interrupted: m.interrupted,
      };
    });

    dispatch({ type: "init_messages", messages: formatted });
  }, [sessionDetailQuery.data]);

  const handleSendMessage = async (text: string) => {
    if (consoleState.isStreaming) return;

    let targetSessionId = activeSessionId;
    if (!targetSessionId) {
      const created = await createSessionMutation.mutateAsync();
      targetSessionId = created.id;
      setUserSelectedSessionId(created.id);
    }

    setAiNotConfigured(false);
    const userMsgId = crypto.randomUUID();
    const asstTempId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    dispatch({ type: "user_message_sent", id: userMsgId, text, createdAt: nowIso });
    dispatch({ type: "assistant_turn_started", id: asstTempId, createdAt: nowIso });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`/api/agent-sessions/${targetSessionId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-requested-with": "XMLHttpRequest",
        },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (response.status === 503) {
        setAiNotConfigured(true);
        dispatch({
          type: "agent_event",
          event: {
            type: "error",
            code: "INTEGRATION_NOT_CONFIGURED",
            message: "The AI service is not configured. Add your OpenAI API key to get started.",
          },
        });
        return;
      }

      if (!response.ok) {
        let errorData: { error?: { code?: string; message?: string } } = {};
        try {
          errorData = await response.json();
        } catch {
          // ignore
        }

        dispatch({
          type: "agent_event",
          event: {
            type: "error",
            code: errorData.error?.code || `HTTP_${response.status}`,
            message: errorData.error?.message || "The AI service didn't respond. Try again.",
          },
        });
        return;
      }

      await readSseStream(
        response,
        (event) => {
          dispatch({ type: "agent_event", event });
        },
        controller.signal,
      );
    } catch {
      if (controller.signal.aborted) {
        dispatch({ type: "stream_aborted" });
      } else {
        dispatch({
          type: "agent_event",
          event: {
            type: "error",
            code: "NETWORK_ERROR",
            message: "The AI service didn't respond. Try again.",
          },
        });
      }
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleStopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    dispatch({ type: "stream_aborted" });
  };

  const selectedMessage = consoleState.messages.find(
    (m) => m.id === consoleState.selectedMessageId,
  ) ?? null;

  if (agentQuery.isPending) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="space-y-4 p-4">
        <BackLink href="/agents">All agents</BackLink>
        <p className="text-muted-foreground">Agent not found.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col -m-6">
      {/* Top Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8">
            <Link href={`/agents/${agent.id}`}>
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to agent</span>
            </Link>
          </Button>

          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">{agent.name}</span>
            <Badge variant="outline" className="text-[11px] font-normal">
              v{agent.version}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SessionPicker
            agentId={agent.id}
            selectedSessionId={activeSessionId}
            onSelectSession={setUserSelectedSessionId}
            disabled={consoleState.isStreaming}
          />

          {/* Mobile Inspector Trigger */}
          <Sheet open={mobileInspectorOpen} onOpenChange={setMobileInspectorOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="lg:hidden h-8 gap-1.5 text-xs"
              >
                <PanelRightOpen className="h-3.5 w-3.5" />
                <span>Inspector</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="p-0 sm:max-w-md">
              <SheetHeader className="sr-only">
                <SheetTitle>Turn Inspector</SheetTitle>
              </SheetHeader>
              <InspectorPane message={selectedMessage} />
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* Main Split Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Chat Pane */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {aiNotConfigured ? (
            <div className="p-4">
              <Card className="border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    <CardTitle className="text-sm font-semibold">
                      AI Provider Not Configured
                    </CardTitle>
                  </div>
                  <CardDescription className="text-xs text-amber-800 dark:text-amber-300">
                    To chat with this agent, set your OpenAI API key in your environment variables.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-1 text-xs space-y-2">
                  <p>
                    Configure your OpenAI secret key in your{" "}
                    <code className="font-mono font-semibold">.env.local</code> file and restart your server.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAiNotConfigured(false)}
                    className="h-7 text-xs border-amber-600/40 hover:bg-amber-500/20"
                  >
                    Dismiss
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : null}

          <div className="flex-1 overflow-hidden">
            <ChatPane
              messages={consoleState.messages}
              isStreaming={consoleState.isStreaming}
              selectedMessageId={consoleState.selectedMessageId}
              onSelectMessage={(id) => dispatch({ type: "select_message", id })}
              onSendMessage={handleSendMessage}
              onStopStreaming={handleStopStreaming}
            />
          </div>
        </div>

        {/* Right: Inspector Pane (Desktop) */}
        <aside className="hidden lg:flex w-80 xl:w-96 shrink-0 flex-col border-l bg-card">
          <InspectorPane message={selectedMessage} />
        </aside>
      </div>
    </div>
  );
}
