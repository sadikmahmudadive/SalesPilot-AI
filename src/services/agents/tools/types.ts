/**
 * Agent tool contracts. Pure (types and constants only), so tools, the registry and the engine
 * can all import it.
 *
 * Outcomes carry STATIC messages only: a failure never echoes the model's arguments or any
 * internal data (the message goes back to the model, and prompt-injected text must not be able
 * to round-trip through it).
 */
import type { ZodType } from "zod";

import type { Agent, AgentChannel, ToolName } from "@/schemas/agent";

export interface ToolContext {
  /** Server-derived. Every read a tool does is scoped to this organization. */
  organizationId: string;
  agent: Agent;
  sessionId: string;
  channel: AgentChannel;
  actorUid: string;
}

/** What a write tool WOULD have done (test channel): returned instead of writing. */
export interface DryRunAction {
  kind: "create_customer" | "update_customer" | "escalate";
  fields: Record<string, unknown>;
}

export type ToolFailureCode = "not_found" | "denied" | "invalid" | "failed";

export type ToolOutcome<O> =
  | { ok: true; data: O; dryRunAction?: DryRunAction }
  | { ok: false; code: ToolFailureCode; message: string };

export const TOOL_MESSAGES: Readonly<Record<ToolFailureCode, string>> = {
  not_found: "That product isn't available.",
  denied: "That tool isn't available to this agent.",
  invalid: "The request to the tool was invalid.",
  failed: "The tool failed. Offer to connect the customer with a person.",
};

/** A failed outcome with the static message of `code` (or an explicit static `message`). */
export function toolFailure(
  code: ToolFailureCode,
  message: string = TOOL_MESSAGES[code],
): { ok: false; code: ToolFailureCode; message: string } {
  return { ok: false, code, message };
}

export interface AgentTool<I, O> {
  name: ToolName;
  /** Written for the model: when to call the tool and what it returns. */
  description: string;
  /** Zod input schema; converted to a strict JSON schema for the provider. No records/tuples. */
  input: ZodType<I>;
  /** Parsed over the tool's data before it is returned (strips anything not declared). */
  output: ZodType<O>;
  /** True when the tool changes data on live channels. */
  writes: boolean;
  run(ctx: ToolContext, input: I): Promise<ToolOutcome<O>>;
}

/** Erases the argument/result types so tools of different shapes fit one registry. */
export function defineTool<I, O>(tool: AgentTool<I, O>): AgentTool<unknown, unknown> {
  return tool as unknown as AgentTool<unknown, unknown>;
}
