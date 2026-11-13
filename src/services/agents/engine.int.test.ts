import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { createMockProvider } from "@/lib/ai/mock-provider";
import { ConflictError, AiProviderError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { AGENT_SESSIONS } from "@/repositories/agent-sessions";
import { agentInputSchema } from "@/schemas/agent";

import { createAgent, updateAgent, type AgentCtx } from "./agents";
import { runAgentTurn } from "./engine";
import type { AgentEvent } from "./events";
import { createSession, getSessionWithMessages } from "./sessions";

const orgs: string[] = [];
function newCtx(): AgentCtx {
  const organizationId = `org-${randomUUID()}`;
  orgs.push(organizationId);
  return { organizationId, uid: `uid-${randomUUID()}` };
}

const make = (over: Record<string, unknown> = {}) =>
  agentInputSchema.parse({ name: "Agent Test", role: "retail_sales", ...over });

afterAll(async () => {
  const db = adminDb();
  await Promise.all(
    orgs.flatMap(async (org) => {
      for (const col of ["agents", AGENT_SESSIONS, "customers", "customerPhones", "auditLogs"]) {
        const snap = await db.collection(col).where("organizationId", "==", org).get();
        await Promise.all(snap.docs.map((d) => db.recursiveDelete(d.ref)));
      }
    }),
  );
}, 60_000);

describe("agent execution engine (integration)", () => {
  it("runs a plain reply turn and persists messages, version, usage and session turnCount", async () => {
    const ctx = newCtx();

    const agent = await createAgent(ctx, make({
      name: "Retail Bot",
      role: "retail_sales",
      instructions: "Be helpful.",
    }));

    const session = await createSession(ctx, agent.id, "test");
    const events: AgentEvent[] = [];

    const mockProvider = createMockProvider([
      {
        text: "Hello! How can I help you today?",
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 25 },
        stopReason: "end",
      },
    ]);

    const result = await runAgentTurn(
      { provider: mockProvider },
      {
        ctx,
        sessionId: session.id,
        userText: "Hello there",
        emit: (e) => events.push(e),
      },
    );

    expect(result.interrupted).toBe(false);
    expect(result.messageId).toBeDefined();

    // Verify events emitted
    expect(events.some((e) => e.type === "text_delta" && e.text.includes("Hello!"))).toBe(true);
    const doneEvt = events.find((e) => e.type === "done");
    expect(doneEvt).toBeDefined();
    if (doneEvt && doneEvt.type === "done") {
      expect(doneEvt.usage).toEqual({ inputTokens: 100, outputTokens: 25 });
      expect(doneEvt.warnings).toEqual([]);
    }

    // Verify database state
    const { session: updatedSession, messages } = await getSessionWithMessages(ctx, session.id);
    expect(updatedSession.turnCount).toBe(1);
    expect(updatedSession.usage).toEqual({ inputTokens: 100, outputTokens: 25 });
    expect(messages.length).toBe(2);

    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.text).toBe("Hello there");

    expect(messages[1]!.role).toBe("assistant");
    expect(messages[1]!.text).toBe("Hello! How can I help you today?");
    expect(messages[1]!.agentVersion).toBe(1);
    expect(messages[1]!.toolCalls).toEqual([]);
  });

  it("executes a tool, feeds result to next call, and returns final reply", async () => {
    const ctx = newCtx();

    const agent = await createAgent(ctx, make({
      name: "Search Bot",
      role: "retail_sales",
      tools: ["search_products"],
    }));

    const session = await createSession(ctx, agent.id, "test");
    const events: AgentEvent[] = [];

    const callId = "call_search_1";
    const mockProvider = createMockProvider([
      // Step 1: Model asks to search products
      {
        text: "",
        toolCalls: [
          {
            id: callId,
            name: "search_products",
            argumentsJson: JSON.stringify({ query: "shirt" }),
          },
        ],
        usage: { inputTokens: 80, outputTokens: 20 },
        stopReason: "tool_calls",
      },
      // Step 2: Model receives tool output and replies with text
      {
        text: "We currently have no shirts in stock.",
        toolCalls: [],
        usage: { inputTokens: 120, outputTokens: 15 },
        stopReason: "end",
      },
    ]);

    await runAgentTurn(
      { provider: mockProvider },
      {
        ctx,
        sessionId: session.id,
        userText: "Do you have shirts?",
        emit: (e) => events.push(e),
      },
    );

    // Verify tool events
    expect(events.some((e) => e.type === "tool_started" && e.callId === callId)).toBe(true);
    expect(events.some((e) => e.type === "tool_finished" && e.callId === callId && e.status === "ok")).toBe(true);

    // Verify second request carried tool results
    expect(mockProvider.calls.length).toBe(2);
    const secondCallMessages = mockProvider.calls[1]!.messages;
    expect(secondCallMessages.some((m) => m.role === "tool" && m.toolCallId === callId)).toBe(true);

    // Verify stored messages
    const { messages } = await getSessionWithMessages(ctx, session.id);
    expect(messages[1]!.toolCalls?.length).toBe(1);
    expect(messages[1]!.toolCalls?.[0]?.name).toBe("search_products");
    expect(messages[1]!.toolCalls?.[0]?.status).toBe("ok");
  });

  it("triggers wrap-up without tools when maxToolCallsPerTurn is reached", async () => {
    const ctx = newCtx();

    const agent = await createAgent(ctx, make({
      name: "Tool Limit Bot",
      role: "retail_sales",
      tools: ["search_products"],
      limits: { maxToolCallsPerTurn: 1, maxTurnsPerSession: 10, maxOutputTokens: 500 },
    }));

    const session = await createSession(ctx, agent.id, "test");
    const events: AgentEvent[] = [];

    const mockProvider = createMockProvider([
      // Step 1: Tool call (hits max 1 tool call)
      {
        text: "",
        toolCalls: [
          {
            id: "call_1",
            name: "search_products",
            argumentsJson: JSON.stringify({ query: "shirt" }),
          },
        ],
        usage: { inputTokens: 50, outputTokens: 15 },
        stopReason: "tool_calls",
      },
      // Step 2: Wrap-up call without tools
      {
        text: "Here is your wrap up answer.",
        toolCalls: [],
        usage: { inputTokens: 80, outputTokens: 20 },
        stopReason: "end",
      },
    ]);

    await runAgentTurn(
      { provider: mockProvider },
      {
        ctx,
        sessionId: session.id,
        userText: "Show shirts",
        emit: (e) => events.push(e),
      },
    );

    // Assert second call had empty tools array
    expect(mockProvider.calls.length).toBe(2);
    expect(mockProvider.calls[1]!.tools).toEqual([]);
  });

  it("triggers wrap-up without tools when budget is exceeded", async () => {
    const ctx = newCtx();

    const agent = await createAgent(ctx, make({
      name: "Budget Bot",
      role: "retail_sales",
      tools: ["search_products"],
    }));

    const session = await createSession(ctx, agent.id, "test");
    const events: AgentEvent[] = [];

    let currentTime = 1000;
    const now = () => currentTime;

    const mockProvider = createMockProvider([
      // Step 1: Tool call at t=1000
      () => {
        // Advance time beyond 25,000ms budget
        currentTime = 30000;
        return {
          text: "",
          toolCalls: [
            {
              id: "call_slow",
              name: "search_products",
              argumentsJson: JSON.stringify({ query: "pants" }),
            },
          ],
          usage: { inputTokens: 50, outputTokens: 15 },
          stopReason: "tool_calls",
        };
      },
      // Step 2: Wrap up call
      {
        text: "Time is up, wrap up reply.",
        toolCalls: [],
        usage: { inputTokens: 70, outputTokens: 10 },
        stopReason: "end",
      },
    ]);

    await runAgentTurn(
      { provider: mockProvider, now, budgetMs: 25000 },
      {
        ctx,
        sessionId: session.id,
        userText: "Show pants",
        emit: (e) => events.push(e),
      },
    );

    expect(mockProvider.calls.length).toBe(2);
    expect(mockProvider.calls[1]!.tools).toEqual([]);
  });

  it("denies tools not in agent allow-list without leaking data", async () => {
    const ctx = newCtx();

    // Agent only has search_products, NOT save_customer_info
    const agent = await createAgent(ctx, make({
      name: "Restricted Bot",
      role: "retail_sales",
      tools: ["search_products"],
    }));

    const session = await createSession(ctx, agent.id, "test");
    const events: AgentEvent[] = [];

    const mockProvider = createMockProvider([
      {
        text: "",
        toolCalls: [
          {
            id: "call_denied",
            name: "save_customer_info",
            argumentsJson: JSON.stringify({ phone: "01712345678" }),
          },
        ],
        usage: { inputTokens: 50, outputTokens: 15 },
        stopReason: "tool_calls",
      },
      {
        text: "I am not able to save customer details.",
        toolCalls: [],
        usage: { inputTokens: 70, outputTokens: 10 },
        stopReason: "end",
      },
    ]);

    await runAgentTurn(
      { provider: mockProvider },
      {
        ctx,
        sessionId: session.id,
        userText: "Save my number",
        emit: (e) => events.push(e),
      },
    );

    const finishEvt = events.find((e) => e.type === "tool_finished");
    expect(finishEvt).toBeDefined();
    if (finishEvt && finishEvt.type === "tool_finished") {
      expect(finishEvt.status).toBe("denied");
      expect(finishEvt.resultSummary).toMatch(/isn't available/i);
    }
  });

  it("handles malformed tool arguments twice with polite fallback and no crash", async () => {
    const ctx = newCtx();

    const agent = await createAgent(ctx, make({
      name: "Robust Bot",
      role: "retail_sales",
      tools: ["search_products"],
    }));

    const session = await createSession(ctx, agent.id, "test");
    const events: AgentEvent[] = [];

    const mockProvider = createMockProvider([
      {
        text: "",
        toolCalls: [
          { id: "bad_1", name: "search_products", argumentsJson: "{malformed json" },
        ],
        usage: { inputTokens: 50, outputTokens: 15 },
        stopReason: "tool_calls",
      },
      {
        text: "",
        toolCalls: [
          { id: "bad_2", name: "search_products", argumentsJson: "not json at all" },
        ],
        usage: { inputTokens: 60, outputTokens: 15 },
        stopReason: "tool_calls",
      },
    ]);

    await runAgentTurn(
      { provider: mockProvider },
      {
        ctx,
        sessionId: session.id,
        userText: "Trigger bad json",
        emit: (e) => events.push(e),
      },
    );

    // Should have caught both errors and emitted fallback without throwing
    expect(events.some((e) => e.type === "text_delta" && e.text.includes("apologize"))).toBe(true);
  });

  it("emits dry_run_action on test channel and keeps CRM unchanged", async () => {
    const ctx = newCtx();

    const agent = await createAgent(ctx, make({
      name: "CRM Dry Bot",
      role: "retail_sales",
      tools: ["save_customer_info"],
    }));

    const session = await createSession(ctx, agent.id, "test");
    const events: AgentEvent[] = [];

    const mockProvider = createMockProvider([
      {
        text: "",
        toolCalls: [
          {
            id: "call_save",
            name: "save_customer_info",
            argumentsJson: JSON.stringify({ phone: "01712345678", fullName: "Jamal" }),
          },
        ],
        usage: { inputTokens: 50, outputTokens: 20 },
        stopReason: "tool_calls",
      },
      {
        text: "I noted down your info Jamal.",
        toolCalls: [],
        usage: { inputTokens: 80, outputTokens: 10 },
        stopReason: "end",
      },
    ]);

    await runAgentTurn(
      { provider: mockProvider },
      {
        ctx,
        sessionId: session.id,
        userText: "My name is Jamal, phone 01712345678",
        emit: (e) => events.push(e),
      },
    );

    const dryRun = events.find((e) => e.type === "dry_run_action");
    expect(dryRun).toBeDefined();
    if (dryRun && dryRun.type === "dry_run_action") {
      expect(dryRun.action.kind).toBe("create_customer");
      expect(dryRun.action.fields["fullName"]).toBe("Jamal");
    }
  });

  it("flags unverified_figure warning when reply quotes a price not in tool data", async () => {
    const ctx = newCtx();

    const agent = await createAgent(ctx, make({
      name: "Hallucinating Bot",
      role: "retail_sales",
      tools: ["search_products"],
    }));

    const session = await createSession(ctx, agent.id, "test");
    const events: AgentEvent[] = [];

    // Model invents price ৳9,999 with no tool data
    const mockProvider = createMockProvider([
      {
        text: "This premium jacket is \u09F39,999.",
        toolCalls: [],
        usage: { inputTokens: 40, outputTokens: 15 },
        stopReason: "end",
      },
    ]);

    await runAgentTurn(
      { provider: mockProvider },
      {
        ctx,
        sessionId: session.id,
        userText: "How much is the jacket?",
        emit: (e) => events.push(e),
      },
    );

    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    if (done && done.type === "done") {
      expect(done.warnings).toContain("unverified_figure");
    }
  });

  it("uses the current agent instructions and version when edited between turns", async () => {
    const ctx = newCtx();

    const agent = await createAgent(ctx, make({
      name: "Versioned Bot",
      role: "retail_sales",
      instructions: "Original instructions v1.",
    }));

    const session = await createSession(ctx, agent.id, "test");

    // Turn 1
    const p1 = createMockProvider([
      {
        text: "Turn 1 reply",
        toolCalls: [],
        usage: { inputTokens: 20, outputTokens: 5 },
        stopReason: "end",
      },
    ]);
    await runAgentTurn({ provider: p1 }, { ctx, sessionId: session.id, userText: "Turn 1", emit: () => {} });

    // Update agent instructions (bumps version to 2)
    await updateAgent(ctx, agent.id, { instructions: "Updated instructions v2." });

    // Turn 2
    const p2 = createMockProvider([
      {
        text: "Turn 2 reply",
        toolCalls: [],
        usage: { inputTokens: 25, outputTokens: 5 },
        stopReason: "end",
      },
    ]);
    await runAgentTurn({ provider: p2 }, { ctx, sessionId: session.id, userText: "Turn 2", emit: () => {} });

    // Verify turn 2 system prompt contained v2 instructions
    expect(p2.calls[0]!.system).toContain("Updated instructions v2.");

    // Verify assistant messages have recorded version
    const { messages } = await getSessionWithMessages(ctx, session.id);
    expect(messages[1]!.agentVersion).toBe(1);
    expect(messages[3]!.agentVersion).toBe(2);
  });

  it("saves interrupted message and counts turn once when aborted mid-stream", async () => {
    const ctx = newCtx();

    const agent = await createAgent(ctx, make({
      name: "Abort Bot",
      role: "retail_sales",
    }));

    const session = await createSession(ctx, agent.id, "test");
    const controller = new AbortController();

    const mockProvider = createMockProvider([
      () => {
        controller.abort();
        return {
          text: "Partial text before abort",
          toolCalls: [],
          usage: { inputTokens: 20, outputTokens: 5 },
          stopReason: "end",
        };
      },
    ]);

    const result = await runAgentTurn(
      { provider: mockProvider },
      {
        ctx,
        sessionId: session.id,
        userText: "Hello",
        signal: controller.signal,
        emit: () => {},
      },
    );

    expect(result.interrupted).toBe(true);

    const { session: reloaded, messages } = await getSessionWithMessages(ctx, session.id);
    expect(reloaded.turnCount).toBe(1);
    expect(messages[1]!.interrupted).toBe(true);
  });

  it("refuses turn with ConflictError when turn count limit is reached", async () => {
    const ctx = newCtx();

    const agent = await createAgent(ctx, make({
      name: "Limited Turns Bot",
      role: "retail_sales",
      limits: { maxTurnsPerSession: 1, maxToolCallsPerTurn: 4, maxOutputTokens: 500 },
    }));

    const session = await createSession(ctx, agent.id, "test");

    // Turn 1 succeeds
    const p1 = createMockProvider([
      { text: "Reply 1", toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: "end" },
    ]);
    await runAgentTurn({ provider: p1 }, { ctx, sessionId: session.id, userText: "Turn 1", emit: () => {} });

    // Turn 2 is refused
    const p2 = createMockProvider([]);
    await expect(
      runAgentTurn({ provider: p2 }, { ctx, sessionId: session.id, userText: "Turn 2", emit: () => {} }),
    ).rejects.toThrow(ConflictError);
  });

  it("handles AiProviderError by emitting error event and saving user message", async () => {
    const ctx = newCtx();

    const agent = await createAgent(ctx, make({
      name: "Provider Error Bot",
      role: "retail_sales",
    }));

    const session = await createSession(ctx, agent.id, "test");
    const events: AgentEvent[] = [];

    const mockProvider = createMockProvider([
      new AiProviderError("unavailable"),
    ]);

    await runAgentTurn(
      { provider: mockProvider },
      {
        ctx,
        sessionId: session.id,
        userText: "Hello error",
        emit: (e) => events.push(e),
      },
    );

    const errEvt = events.find((e) => e.type === "error");
    expect(errEvt).toBeDefined();
    if (errEvt && errEvt.type === "error") {
      expect(errEvt.code).toBe("unavailable");
      expect(errEvt.message).toMatch(/AI service didn't respond/i);
    }

    // User message was still preserved
    const { messages } = await getSessionWithMessages(ctx, session.id);
    expect(messages.length).toBe(1);
    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.text).toBe("Hello error");
  });
});
