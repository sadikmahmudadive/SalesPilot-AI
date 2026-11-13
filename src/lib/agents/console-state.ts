/**
 * Pure state reducer and types for the Agent Test Console.
 *
 * Tracks the messages transcript, tool execution rows, dry-run actions, warnings,
 * usage, latency, and streaming states.
 */
import type { AgentEvent } from "@/services/agents/events";
import type { DryRunAction } from "@/services/agents/tools/types";

export interface InspectorToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status?: "ok" | "error" | "denied";
  resultSummary?: string;
  durationMs?: number;
  dryRunAction?: DryRunAction;
}

export interface ConsoleMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  agentVersion?: number;
  toolCalls?: InspectorToolCall[];
  warnings?: string[];
  usage?: { inputTokens: number; outputTokens: number };
  latencyMs?: number;
  interrupted?: boolean;
  error?: { code: string; message: string; requestId?: string };
}

export interface ConsoleState {
  messages: ConsoleMessage[];
  streamingMessageId: string | null;
  selectedMessageId: string | null;
  isStreaming: boolean;
}

export const INITIAL_CONSOLE_STATE: ConsoleState = {
  messages: [],
  streamingMessageId: null,
  selectedMessageId: null,
  isStreaming: false,
};

export type ConsoleAction =
  | { type: "init_messages"; messages: ConsoleMessage[] }
  | { type: "user_message_sent"; id: string; text: string; createdAt: string }
  | { type: "assistant_turn_started"; id: string; createdAt: string }
  | { type: "agent_event"; event: AgentEvent }
  | { type: "stream_aborted" }
  | { type: "select_message"; id: string | null };

export function consoleReducer(state: ConsoleState, action: ConsoleAction): ConsoleState {
  switch (action.type) {
    case "init_messages": {
      // Pick the latest assistant message as selected for inspector by default
      const lastAsst = [...action.messages].reverse().find((m) => m.role === "assistant");
      return {
        ...state,
        messages: action.messages,
        selectedMessageId: lastAsst?.id ?? null,
        streamingMessageId: null,
        isStreaming: false,
      };
    }

    case "user_message_sent": {
      const userMsg: ConsoleMessage = {
        id: action.id,
        role: "user",
        text: action.text,
        createdAt: action.createdAt,
      };
      return {
        ...state,
        messages: [...state.messages, userMsg],
      };
    }

    case "assistant_turn_started": {
      const asstMsg: ConsoleMessage = {
        id: action.id,
        role: "assistant",
        text: "",
        createdAt: action.createdAt,
        toolCalls: [],
        warnings: [],
      };
      return {
        ...state,
        messages: [...state.messages, asstMsg],
        streamingMessageId: action.id,
        selectedMessageId: action.id,
        isStreaming: true,
      };
    }

    case "stream_aborted": {
      if (!state.streamingMessageId) {
        return { ...state, isStreaming: false };
      }
      return {
        ...state,
        isStreaming: false,
        streamingMessageId: null,
        messages: state.messages.map((m) =>
          m.id === state.streamingMessageId ? { ...m, interrupted: true } : m,
        ),
      };
    }

    case "select_message": {
      return {
        ...state,
        selectedMessageId: action.id,
      };
    }

    case "agent_event": {
      const event = action.event;
      const targetId = state.streamingMessageId;
      if (!targetId) return state;

      switch (event.type) {
        case "text_delta": {
          return {
            ...state,
            messages: state.messages.map((m) =>
              m.id === targetId ? { ...m, text: m.text + event.text } : m,
            ),
          };
        }

        case "tool_started": {
          const toolCall: InspectorToolCall = {
            id: event.callId,
            name: event.name,
            args: event.args,
          };
          return {
            ...state,
            messages: state.messages.map((m) => {
              if (m.id !== targetId) return m;
              const tools = m.toolCalls ? [...m.toolCalls] : [];
              tools.push(toolCall);
              return { ...m, toolCalls: tools };
            }),
          };
        }

        case "tool_finished": {
          return {
            ...state,
            messages: state.messages.map((m) => {
              if (m.id !== targetId) return m;
              const tools = (m.toolCalls ?? []).map((t) =>
                t.id === event.callId
                  ? {
                      ...t,
                      status: event.status,
                      resultSummary: event.resultSummary,
                      durationMs: event.durationMs,
                    }
                  : t,
              );
              return { ...m, toolCalls: tools };
            }),
          };
        }

        case "dry_run_action": {
          return {
            ...state,
            messages: state.messages.map((m) => {
              if (m.id !== targetId) return m;
              const tools = (m.toolCalls ?? []).map((t) =>
                t.id === event.callId
                  ? {
                      ...t,
                      dryRunAction: event.action,
                    }
                  : t,
              );
              return { ...m, toolCalls: tools };
            }),
          };
        }

        case "done": {
          return {
            ...state,
            isStreaming: false,
            streamingMessageId: null,
            selectedMessageId: event.messageId,
            messages: state.messages.map((m) =>
              m.id === targetId
                ? {
                    ...m,
                    id: event.messageId,
                    usage: event.usage,
                    warnings: event.warnings,
                    latencyMs: event.latencyMs,
                  }
                : m,
            ),
          };
        }

        case "error": {
          return {
            ...state,
            isStreaming: false,
            streamingMessageId: null,
            messages: state.messages.map((m) =>
              m.id === targetId
                ? {
                    ...m,
                    error: {
                      code: event.code,
                      message: event.message,
                      requestId: event.requestId,
                    },
                  }
                : m,
            ),
          };
        }

        default:
          return state;
      }
    }

    default:
      return state;
  }
}
