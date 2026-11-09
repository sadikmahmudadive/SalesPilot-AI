import type { DryRunAction } from "./tools/types";

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; callId: string; name: string; args: Record<string, unknown> }
  | {
      type: "tool_finished";
      callId: string;
      name: string;
      status: "ok" | "error" | "denied";
      resultSummary: string;
      durationMs: number;
    }
  | { type: "dry_run_action"; callId: string; action: DryRunAction }
  | {
      type: "done";
      messageId: string;
      usage: { inputTokens: number; outputTokens: number };
      warnings: string[];
      latencyMs: number;
    }
  | { type: "error"; code: string; message: string; requestId?: string };

/**
 * Encodes an AgentEvent into a Server-Sent Events (SSE) data frame.
 * Format: `event: <type>\ndata: <json>\n\n`
 */
export function encodeSse(event: AgentEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
