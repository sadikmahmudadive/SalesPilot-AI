import { describe, expect, it } from "vitest";

import type { AgentEvent } from "@/services/agents/events";

import {
  consoleReducer,
  INITIAL_CONSOLE_STATE,
} from "./console-state";

describe("consoleReducer", () => {
  it("accumulates text deltas, tool rows and done event into an assistant message", () => {
    let state = INITIAL_CONSOLE_STATE;

    // 1. User sends message
    state = consoleReducer(state, {
      type: "user_message_sent",
      id: "user-1",
      text: "Show red shirts",
      createdAt: "2026-11-10T00:00:00.000Z",
    });

    expect(state.messages.length).toBe(1);
    expect(state.messages[0]?.role).toBe("user");

    // 2. Assistant turn starts
    state = consoleReducer(state, {
      type: "assistant_turn_started",
      id: "asst-temp-1",
      createdAt: "2026-11-10T00:00:01.000Z",
    });

    expect(state.messages.length).toBe(2);
    expect(state.isStreaming).toBe(true);

    // 3. Events arrive
    const events: AgentEvent[] = [
      { type: "text_delta", text: "Checking " },
      {
        type: "tool_started",
        callId: "call-1",
        name: "search_products",
        args: { query: "red shirt" },
      },
      {
        type: "tool_finished",
        callId: "call-1",
        name: "search_products",
        status: "ok",
        resultSummary: "Found 1 item",
        durationMs: 45,
      },
      { type: "text_delta", text: "catalog..." },
      {
        type: "done",
        messageId: "asst-final-1",
        usage: { inputTokens: 50, outputTokens: 20 },
        warnings: ["unverified_figure"],
        latencyMs: 350,
      },
    ];

    for (const event of events) {
      state = consoleReducer(state, { type: "agent_event", event });
    }

    expect(state.isStreaming).toBe(false);
    expect(state.streamingMessageId).toBeNull();

    const asstMsg = state.messages[1]!;
    expect(asstMsg).toBeDefined();
    expect(asstMsg.id).toBe("asst-final-1");
    expect(asstMsg.role).toBe("assistant");
    expect(asstMsg.text).toBe("Checking catalog...");
    expect(asstMsg.usage).toEqual({ inputTokens: 50, outputTokens: 20 });
    expect(asstMsg.warnings).toEqual(["unverified_figure"]);
    expect(asstMsg.latencyMs).toBe(350);

    expect(asstMsg.toolCalls?.length).toBe(1);
    expect(asstMsg.toolCalls?.[0]).toEqual({
      id: "call-1",
      name: "search_products",
      args: { query: "red shirt" },
      status: "ok",
      resultSummary: "Found 1 item",
      durationMs: 45,
    });
  });

  it("attaches dry_run_action to matching tool call", () => {
    let state = INITIAL_CONSOLE_STATE;
    state = consoleReducer(state, {
      type: "assistant_turn_started",
      id: "asst-1",
      createdAt: "2026-11-10T00:00:01.000Z",
    });

    state = consoleReducer(state, {
      type: "agent_event",
      event: {
        type: "tool_started",
        callId: "call-dry",
        name: "save_customer_info",
        args: { phone: "01711000000" },
      },
    });

    state = consoleReducer(state, {
      type: "agent_event",
      event: {
        type: "dry_run_action",
        callId: "call-dry",
        action: {
          kind: "create_customer",
          fields: { phone: "+8801711000000" },
        },
      },
    });

    const asstMsg = state.messages[0]!;
    expect(asstMsg.toolCalls?.[0]?.dryRunAction).toEqual({
      kind: "create_customer",
      fields: { phone: "+8801711000000" },
    });
  });

  it("handles error event by setting error on assistant message and ending stream", () => {
    let state = INITIAL_CONSOLE_STATE;
    state = consoleReducer(state, {
      type: "user_message_sent",
      id: "u-1",
      text: "Hi",
      createdAt: "2026-11-10T00:00:00.000Z",
    });

    state = consoleReducer(state, {
      type: "assistant_turn_started",
      id: "a-1",
      createdAt: "2026-11-10T00:00:01.000Z",
    });

    state = consoleReducer(state, {
      type: "agent_event",
      event: {
        type: "error",
        code: "unavailable",
        message: "The AI service didn't respond. Try again.",
        requestId: "req-123",
      },
    });

    expect(state.isStreaming).toBe(false);
    expect(state.messages.length).toBe(2);
    expect(state.messages[0]?.text).toBe("Hi");
    expect(state.messages[1]?.error).toEqual({
      code: "unavailable",
      message: "The AI service didn't respond. Try again.",
      requestId: "req-123",
    });
  });

  it("marks assistant message as interrupted on stream_aborted", () => {
    let state = INITIAL_CONSOLE_STATE;
    state = consoleReducer(state, {
      type: "assistant_turn_started",
      id: "a-1",
      createdAt: "2026-11-10T00:00:01.000Z",
    });

    state = consoleReducer(state, {
      type: "agent_event",
      event: { type: "text_delta", text: "Partial text" },
    });

    state = consoleReducer(state, { type: "stream_aborted" });

    expect(state.isStreaming).toBe(false);
    expect(state.messages[0]?.interrupted).toBe(true);
    expect(state.messages[0]?.text).toBe("Partial text");
  });
});
