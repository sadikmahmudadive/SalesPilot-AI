/**
 * Client-side Server-Sent Events (SSE) stream reader.
 *
 * Reads chunks from a Response body stream, reassembles frames across chunk boundaries,
 * handles both CRLF and LF, validates event payloads, and forwards typed AgentEvents.
 */
import type { AgentEvent } from "@/services/agents/events";

const KNOWN_EVENT_TYPES = new Set([
  "text_delta",
  "tool_started",
  "tool_finished",
  "dry_run_action",
  "done",
  "error",
]);

/**
 * Reads an SSE Response stream and emits AgentEvent callbacks.
 */
export async function readSseStream(
  response: Response,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by two newlines (\n\n or \r\n\r\n)
      // Normalize CRLF to LF for consistent frame splitting
      const normalized = buffer.replace(/\r\n/g, "\n");
      const frames = normalized.split("\n\n");

      // The last element is either incomplete or empty
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        if (!frame.trim()) continue;

        let eventType: string | undefined;
        let dataPayload: string | undefined;

        const lines = frame.split("\n");
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            dataPayload = (dataPayload !== undefined ? `${dataPayload}\n` : "") + line.slice(6);
          }
        }

        if (!dataPayload) continue;
        if (eventType && !KNOWN_EVENT_TYPES.has(eventType)) continue;

        try {
          const parsed = JSON.parse(dataPayload) as AgentEvent;
          if (parsed && typeof parsed.type === "string" && KNOWN_EVENT_TYPES.has(parsed.type)) {
            onEvent(parsed);
          }
        } catch {
          // Ignore invalid JSON frames
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Reader may already be closed
    }
  }
}
