import { describe, expect, it } from "vitest";

import type { AgentEvent } from "@/services/agents/events";
import { encodeSse } from "@/services/agents/events";

import { readSseStream } from "./sse-client";

function mockResponseFromChunks(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

describe("readSseStream", () => {
  it("parses single and multiple events correctly", async () => {
    const e1: AgentEvent = { type: "text_delta", text: "Hello" };
    const e2: AgentEvent = { type: "text_delta", text: " world" };
    const e3: AgentEvent = {
      type: "done",
      messageId: "msg-1",
      usage: { inputTokens: 5, outputTokens: 5 },
      warnings: [],
      latencyMs: 120,
    };

    const raw = encodeSse(e1) + encodeSse(e2) + encodeSse(e3);
    const res = mockResponseFromChunks([raw]);

    const received: AgentEvent[] = [];
    await readSseStream(res, (e) => received.push(e));

    expect(received).toEqual([e1, e2, e3]);
  });

  it("handles arbitrary chunk splits across boundaries", async () => {
    const e1: AgentEvent = { type: "text_delta", text: "Streaming" };
    const raw = encodeSse(e1);

    // Split across awkward boundaries: 'eve', 'nt: text_delta\nda', 'ta: {"type":"text_delta","text":"Streaming"}\n\n'
    const part1 = raw.slice(0, 3);
    const part2 = raw.slice(3, 20);
    const part3 = raw.slice(20);

    const res = mockResponseFromChunks([part1, part2, part3]);
    const received: AgentEvent[] = [];
    await readSseStream(res, (e) => received.push(e));

    expect(received).toEqual([e1]);
  });

  it("handles CRLF (\\r\\n) line endings", async () => {
    const e: AgentEvent = { type: "text_delta", text: "CRLF test" };
    const raw = `event: text_delta\r\ndata: ${JSON.stringify(e)}\r\n\r\n`;

    const res = mockResponseFromChunks([raw]);
    const received: AgentEvent[] = [];
    await readSseStream(res, (e) => received.push(e));

    expect(received).toEqual([e]);
  });

  it("ignores unknown event types or malformed frames gracefully", async () => {
    const good: AgentEvent = { type: "text_delta", text: "valid" };
    const unknown = `event: unknown_future_event\ndata: {"foo":"bar"}\n\n`;
    const garbage = `garbage frame without data\n\n`;
    const invalidJson = `event: text_delta\ndata: {invalid json\n\n`;

    const raw = unknown + garbage + encodeSse(good) + invalidJson;
    const res = mockResponseFromChunks([raw]);

    const received: AgentEvent[] = [];
    await readSseStream(res, (e) => received.push(e));

    expect(received).toEqual([good]);
  });

  it("stops reading when signal is aborted", async () => {
    const controller = new AbortController();
    const e1: AgentEvent = { type: "text_delta", text: "First" };
    const e2: AgentEvent = { type: "text_delta", text: "Second" };

    const raw1 = encodeSse(e1);
    const raw2 = encodeSse(e2);
    const res = mockResponseFromChunks([raw1, raw2]);

    const received: AgentEvent[] = [];
    await readSseStream(
      res,
      (e) => {
        received.push(e);
        controller.abort();
      },
      controller.signal,
    );

    expect(received).toEqual([e1]);
  });
});
