/**
 * Bounded Agent Execution Engine. Server-only.
 *
 * Implements the turn execution loop: prompt assembly, history retrieval,
 * provider calling, tool execution with permission checking, dry-run event emission,
 * loop bounds (budget and tool count), figure verification, and single batched persistence.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { AiProviderError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { ORGANIZATIONS } from "@/repositories/organizations";
import {
  sessionRepo,
  AGENT_SESSIONS,
  type AgentMessage,
  type AgentToolCallRecord,
} from "@/repositories/agent-sessions";
import type { ChatMessage, ChatProvider, ProviderResult, ToolSpec } from "@/lib/ai/provider";

import type { AgentCtx } from "./agents";
import { getAgent } from "./agents";
import type { AgentEvent } from "./events";
import { findUnverifiedFigures } from "./figures";
import { buildSystemPrompt } from "./prompt";
import { executeTool, toolSpecsFor } from "./tools/registry";
import type { ToolContext, ToolOutcome } from "./tools/types";
import { markEscalated } from "./sessions";

export interface EngineDeps {
  provider: ChatProvider;
  now?: () => number;
  budgetMs?: number;
}

export interface RunAgentTurnInput {
  ctx: AgentCtx;
  sessionId: string;
  userText: string;
  signal?: AbortSignal;
  emit: (e: AgentEvent) => void;
  contactPhoneE164?: string;
}

/**
 * Summarizes a tool outcome for persistence and prompt history (<= 500 chars).
 * Privacy rule: NEVER includes customer phone, email, or address.
 */
export function summarizeToolResult(name: string, outcome: ToolOutcome<unknown>): string {
  if (!outcome.ok) {
    return `Error (${outcome.code}): ${outcome.message}`.slice(0, 500);
  }

  const d = outcome.data as Record<string, unknown>;
  let text = "";

  switch (name) {
    case "search_products": {
      const items = (d.results as Array<{ name: string; priceText: string }>) ?? [];
      const itemStrs = items.map((i) => `${i.name} (${i.priceText})`).join(", ");
      text = `Found ${items.length} products: ${itemStrs}`;
      break;
    }
    case "get_product_details": {
      text = `${d.name}: ${d.priceText}, ${(String(d.description ?? "")).slice(0, 100)}`;
      break;
    }
    case "get_price": {
      text = `${d.priceText}${d.wholesaleFallback ? " (wholesale fallback)" : ""}`;
      break;
    }
    case "check_stock": {
      text = `Status: ${d.status}, Available: ${d.available}`;
      break;
    }
    case "calculate_order_total": {
      text = `Subtotal: ${d.subtotalText}, Lines: ${(d.lines as unknown[])?.length ?? 0}, Excluded: ${d.excludedLines}${d.totalText ? `, Delivery: ${d.deliveryChargeText}, Total: ${d.totalText}` : ""}`;
      break;
    }
    case "lookup_customer": {
      text = `Customer ${d.exists ? "found" : "not found"}${d.fullName ? ` (${d.fullName})` : ""}${d.segment ? `, segment: ${d.segment}` : ""}`;
      break;
    }
    case "save_customer_info": {
      text = `Action: ${d.action}${d.customerId ? `, id: ${d.customerId}` : ""}`;
      break;
    }
    case "escalate_to_human": {
      text = `Escalated: ${d.escalated}`;
      break;
    }
    case "create_draft_order":
    case "update_draft_order": {
      text = `Draft ${d.orderNumber}: total ${d.totalText}`;
      break;
    }
    case "confirm_order": {
      text = `Confirmed ${d.orderNumber}`;
      break;
    }
    case "get_my_order_status": {
      text = `${(d.orders as unknown[] | undefined)?.length ?? 0} orders`;
      break;
    }
    case "send_payment_link": {
      text = `Payment link for ${d.orderNumber}: ${d.url}`;
      break;
    }
    default: {
      text = JSON.stringify(d);
    }
  }

  return text.slice(0, 500);
}

/**
 * Executes a single turn in an agent session.
 */
export async function runAgentTurn(
  deps: EngineDeps,
  input: RunAgentTurnInput,
): Promise<{ messageId: string; interrupted: boolean }> {
  const getNow = deps.now ?? (() => Date.now());
  const budgetMs = deps.budgetMs ?? 25000;
  const startTime = getNow();

  // 1. Load session and verify access
  const session = await sessionRepo.get(input.ctx.organizationId, input.sessionId);
  if (!session) throw new NotFoundError();

  // 2. Load CURRENT agent configuration (Review Focus 3)
  const agent = await getAgent(input.ctx, session.agentId);
  const limits = agent.limits ?? { maxTurnsPerSession: 30, maxToolCallsPerTurn: 4, maxOutputTokens: 600 };

  // 3. Enforce turn limits
  if (session.turnCount >= limits.maxTurnsPerSession) {
    throw new ConflictError(
      "This session has reached its turn limit. Start a new session to continue chatting.",
    );
  }

  // 4. Resolve Organization Name
  let orgName = "Our Shop";
  try {
    const orgSnap = await adminDb().collection(ORGANIZATIONS).doc(input.ctx.organizationId).get();
    if (orgSnap.exists && typeof orgSnap.data()?.name === "string") {
      orgName = orgSnap.data()!.name;
    }
  } catch {
    // Fall back to default
  }

  // 5. Build system prompt
  const systemPrompt = buildSystemPrompt({
    agent,
    organizationName: orgName,
    now: new Date(getNow()),
  });

  // 6. Load last 20 messages for history
  const historySnap = await adminDb()
    .collection(AGENT_SESSIONS)
    .doc(input.sessionId)
    .collection("messages")
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();

  const rawHistory = historySnap.docs.map((d) => d.data() as AgentMessage).reverse();
  const messages: ChatMessage[] = [];

  for (const msg of rawHistory) {
    if (msg.role === "user") {
      messages.push({ role: "user", text: msg.text });
    } else if (msg.role === "assistant") {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          text: msg.text,
          toolCalls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            argumentsJson: JSON.stringify(tc.args),
          })),
        });
        for (const tc of msg.toolCalls) {
          messages.push({
            role: "tool",
            toolCallId: tc.id,
            name: tc.name,
            resultJson: JSON.stringify({ summary: tc.resultSummary }),
          });
        }
      } else {
        messages.push({ role: "assistant", text: msg.text, toolCalls: [] });
      }
    }
  }

  // Append new user message to turn conversation
  messages.push({ role: "user", text: input.userText });

  // 7. Set up loop variables
  const tools: ToolSpec[] = toolSpecsFor(agent);
  const maxToolCalls = limits.maxToolCallsPerTurn;
  let toolCallCount = 0;
  let accumulatedText = "";
  const recordedToolCalls: AgentToolCallRecord[] = [];
  const turnToolData: unknown[] = [];
  const totalUsage = { inputTokens: 0, outputTokens: 0 };
  let isInterrupted = false;
  let malformedCount = 0;
  let forceStop = false;

  const toolCtx: ToolContext = {
    organizationId: input.ctx.organizationId,
    agent,
    sessionId: input.sessionId,
    channel: session.channel,
    actorUid: input.ctx.uid,
    contactPhoneE164: input.contactPhoneE164,
    escalateSession: async (_sId, reason) => {
      await markEscalated(input.ctx, input.sessionId, reason);
    },
  };

  // 8. Agent Loop
  while (true) {
    if (input.signal?.aborted) {
      isInterrupted = true;
      break;
    }

    const elapsed = getNow() - startTime;
    const budgetExceeded = elapsed >= budgetMs;
    const toolCapReached = toolCallCount >= maxToolCalls;
    const wrapUp = budgetExceeded || toolCapReached;

    // When wrapping up, tools are empty to force final text
    const activeTools = wrapUp ? [] : tools;

    let result: ProviderResult;
    try {
      result = await deps.provider.generate({
        model: agent.model || process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
        system: systemPrompt,
        messages,
        tools: activeTools,
        maxOutputTokens: limits.maxOutputTokens,
        signal: input.signal,
        onTextDelta: (delta) => {
          accumulatedText += delta;
          input.emit({ type: "text_delta", text: delta });
        },
      });
    } catch (err) {
      if (input.signal?.aborted) {
        isInterrupted = true;
        break;
      }
      if (err instanceof AiProviderError) {
        input.emit({
          type: "error",
          code: err.kind,
          message: err.message,
        });

        // Save user message so input is not lost
        const userMsgId = randomUUID();
        const nowIso = new Date(getNow()).toISOString();
        await adminDb()
          .collection(AGENT_SESSIONS)
          .doc(input.sessionId)
          .collection("messages")
          .doc(userMsgId)
          .set({
            organizationId: input.ctx.organizationId,
            sessionId: input.sessionId,
            role: "user",
            text: input.userText,
            createdAt: nowIso,
          });

        return { messageId: userMsgId, interrupted: false };
      }
      throw err;
    }

    totalUsage.inputTokens += result.usage.inputTokens;
    totalUsage.outputTokens += result.usage.outputTokens;

    // Handle tool calls
    if (result.toolCalls.length > 0 && !wrapUp) {
      messages.push({
        role: "assistant",
        text: result.text,
        toolCalls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        if (input.signal?.aborted) {
          isInterrupted = true;
          break;
        }

        toolCallCount++;

        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(call.argumentsJson);
        } catch {
          malformedCount++;
        }

        input.emit({
          type: "tool_started",
          callId: call.id,
          name: call.name,
          args: parsedArgs,
        });

        const toolStart = getNow();
        const outcome = await executeTool(toolCtx, call.name, call.argumentsJson);
        const durationMs = getNow() - toolStart;

        if (!outcome.ok && (outcome.code === "invalid" || outcome.code === "denied")) {
          malformedCount++;
        }

        const summary = summarizeToolResult(call.name, outcome);
        const toolStatus: "ok" | "error" | "denied" = outcome.ok
          ? "ok"
          : outcome.code === "denied"
            ? "denied"
            : "error";
        const dryRunAction = outcome.ok ? outcome.dryRunAction : undefined;

        input.emit({
          type: "tool_finished",
          callId: call.id,
          name: call.name,
          status: toolStatus,
          resultSummary: summary,
          durationMs,
        });

        if (dryRunAction) {
          input.emit({
            type: "dry_run_action",
            callId: call.id,
            action: dryRunAction,
          });
        }

        if (outcome.ok) {
          turnToolData.push(outcome.data);
        }

        recordedToolCalls.push({
          id: call.id,
          name: call.name,
          args: parsedArgs,
          resultSummary: summary,
          dryRunAction,
          status: toolStatus,
          durationMs,
        });

        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          resultJson: JSON.stringify(outcome),
        });

        // Malformed or unknown calls repeated twice -> polite fallback
        if (malformedCount >= 2) {
          const fallback =
            "I apologize, but I encountered an issue processing that request. How else can I help you today?";
          accumulatedText += fallback;
          input.emit({ type: "text_delta", text: fallback });
          forceStop = true;
          break;
        }
      }

      if (isInterrupted || forceStop) {
        break;
      }

      // Next iteration with tool results
      continue;
    }

    // Finished turn
    break;
  }

  // 9. Post-loop verification & persistence
  if (input.signal?.aborted) {
    isInterrupted = true;
  }

  const unverified = findUnverifiedFigures(accumulatedText, turnToolData);
  const warnings: string[] = unverified.length > 0 ? ["unverified_figure"] : [];

  const userMsgId = randomUUID();
  const assistantMsgId = randomUUID();
  const userCreatedAt = new Date(startTime).toISOString();
  const latencyMs = Math.max(1, getNow() - startTime);
  const assistantCreatedAt = new Date(startTime + latencyMs).toISOString();

  if (!isInterrupted) {
    input.emit({
      type: "done",
      messageId: assistantMsgId,
      usage: totalUsage,
      warnings,
      latencyMs,
    });
  }

  // 10. Single atomic Firestore batch
  const batch = adminDb().batch();
  const sessionRef = adminDb().collection(AGENT_SESSIONS).doc(input.sessionId);

  // User message
  const userMsgRef = sessionRef.collection("messages").doc(userMsgId);
  batch.set(userMsgRef, {
    organizationId: input.ctx.organizationId,
    sessionId: input.sessionId,
    role: "user",
    text: input.userText,
    createdAt: userCreatedAt,
  });

  // Assistant message
  const assistantMsgRef = sessionRef.collection("messages").doc(assistantMsgId);
  batch.set(assistantMsgRef, {
    organizationId: input.ctx.organizationId,
    sessionId: input.sessionId,
    role: "assistant",
    text: accumulatedText,
    agentVersion: agent.version,
    toolCalls: recordedToolCalls,
    warnings,
    model: agent.model || process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
    usage: totalUsage,
    latencyMs,
    interrupted: isInterrupted,
    createdAt: assistantCreatedAt,
  });

  // Update session counters
  batch.update(sessionRef, {
    turnCount: session.turnCount + 1,
    usage: {
      inputTokens: session.usage.inputTokens + totalUsage.inputTokens,
      outputTokens: session.usage.outputTokens + totalUsage.outputTokens,
    },
    lastMessageAt: assistantCreatedAt,
  });

  await batch.commit();

  return { messageId: assistantMsgId, interrupted: isInterrupted };
}
