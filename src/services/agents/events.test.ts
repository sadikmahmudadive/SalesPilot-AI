import { describe, expect, it } from "vitest";

import { encodeSse, type AgentEvent } from "./events";

describe("encodeSse", () => {
  it("encodes text_delta event in SSE format", () => {
    const event: AgentEvent = { type: "text_delta", text: "Hello from agent" };
    const sse = encodeSse(event);

    expect(sse).toBe('event: text_delta\ndata: {"type":"text_delta","text":"Hello from agent"}\n\n');
  });

  it("escapes raw newlines inside JSON data so the data line has no unescaped newlines", () => {
    const event: AgentEvent = {
      type: "text_delta",
      text: "Line 1\nLine 2\r\nLine 3",
    };
    const sse = encodeSse(event);

    // Splitting by \n\n should yield exactly the single event block
    const blocks = sse.split("\n\n");
    expect(blocks.length).toBe(2);
    expect(blocks[1]).toBe("");

    // The data line must contain escaped \n, not a raw newline
    const lines = blocks[0]!.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe("event: text_delta");
    expect(lines[1]!.startsWith("data: ")).toBe(true);
    expect(JSON.parse(lines[1]!.slice(6))).toEqual(event);
  });

  it("encodes tool events, done and error events properly", () => {
    const toolStarted: AgentEvent = {
      type: "tool_started",
      callId: "call_123",
      name: "search_products",
      args: { query: "shirt" },
    };
    expect(encodeSse(toolStarted)).toContain("event: tool_started");

    const toolFinished: AgentEvent = {
      type: "tool_finished",
      callId: "call_123",
      name: "search_products",
      status: "ok",
      resultSummary: "Found 2 products",
      durationMs: 45,
    };
    expect(encodeSse(toolFinished)).toContain("event: tool_finished");

    const dryRun: AgentEvent = {
      type: "dry_run_action",
      callId: "call_123",
      action: { kind: "escalate", fields: { reason: "Customer request" } },
    };
    expect(encodeSse(dryRun)).toContain("event: dry_run_action");

    const done: AgentEvent = {
      type: "done",
      messageId: "msg_abc",
      usage: { inputTokens: 120, outputTokens: 40 },
      warnings: ["unverified_figure"],
      latencyMs: 820,
    };
    expect(encodeSse(done)).toContain("event: done");

    const errorEvt: AgentEvent = {
      type: "error",
      code: "timeout",
      message: "The AI service didn't respond. Try again.",
    };
    expect(encodeSse(errorEvt)).toContain("event: error");
  });
});
