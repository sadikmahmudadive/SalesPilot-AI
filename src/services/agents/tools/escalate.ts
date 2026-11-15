/**
 * `escalate_to_human`: hand the conversation to a person. Server-only.
 *
 * Test channel: a dry run (`dryRunAction`), nothing is written and `escalateSession` is never
 * called. Live channels: calls `ctx.escalateSession(sessionId, reason)` (provided by the session
 * layer); without it the tool fails closed (`failed`), logged with the tool name only.
 */
import "server-only";

import { z } from "zod";

import { logger } from "@/lib/logger";

import {
  defineTool,
  isLiveChannel,
  toolFailure,
  type ToolContext,
  type ToolOutcome,
} from "./types";

const inputSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe("Why a person should take over, in one short sentence."),
});
type EscalateInput = z.output<typeof inputSchema>;

const outputSchema = z.object({ escalated: z.boolean() });
type EscalateOutput = z.output<typeof outputSchema>;

async function run(ctx: ToolContext, input: EscalateInput): Promise<ToolOutcome<EscalateOutput>> {
  if (!isLiveChannel(ctx.channel)) {
    return {
      ok: true,
      data: { escalated: true },
      dryRunAction: { kind: "escalate", fields: { reason: input.reason } },
    };
  }
  if (!ctx.escalateSession) {
    logger.error("agent tool unavailable", { tool: "escalate_to_human", code: "not_wired" });
    return toolFailure("failed");
  }
  await ctx.escalateSession(ctx.sessionId, input.reason);
  return { ok: true, data: { escalated: true } };
}

export const escalateTool = defineTool<EscalateInput, EscalateOutput>({
  name: "escalate_to_human",
  description:
    "Hand the conversation to a human team member. Use it when the customer asks for a person, " +
    "is upset, or the request is outside what you may do. Give a short reason.",
  input: inputSchema,
  output: outputSchema,
  writes: true,
  run,
});
