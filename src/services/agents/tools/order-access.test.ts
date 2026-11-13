import { describe, expect, it } from "vitest";

import { agentInputSchema, type Agent } from "@/schemas/agent";

import { cleanConfirmationQuote, toolIdempotencyKey } from "./order-access";
import type { ToolContext } from "./types";

const agent: Agent = {
  ...agentInputSchema.parse({ name: "A", role: "order_management" }),
  id: "agent-1",
  organizationId: "org-1",
  version: 1,
  createdBy: "uid-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const ctx = (sessionId: string): ToolContext => ({
  organizationId: "org-1",
  agent,
  sessionId,
  channel: "whatsapp",
  actorUid: "uid-1",
});

describe("toolIdempotencyKey", () => {
  it("is ai_ + 40 hex chars, stable across key order, and differs per session and args", () => {
    const a = toolIdempotencyKey(ctx("s1"), { b: 1, a: [1, 2] });
    expect(a).toMatch(/^ai_[0-9a-f]{40}$/);
    expect(toolIdempotencyKey(ctx("s1"), { a: [1, 2], b: 1 })).toBe(a);
    expect(toolIdempotencyKey(ctx("s2"), { b: 1, a: [1, 2] })).not.toBe(a);
    expect(toolIdempotencyKey(ctx("s1"), { b: 2, a: [1, 2] })).not.toBe(a);
    // Fits the order idempotency key format.
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  });
});

describe("cleanConfirmationQuote", () => {
  it("strips control characters, trims and caps at 200 characters", () => {
    expect(cleanConfirmationQuote("  Ji\u0000 confirm\u0007\n korun \u001b")).toBe(
      "Ji confirm korun",
    );
    expect(cleanConfirmationQuote("x".repeat(250))).toHaveLength(200);
    expect(cleanConfirmationQuote("\u0000\u0001  ")).toBe("");
  });

  it("never splits a surrogate pair at the cap", () => {
    const out = cleanConfirmationQuote("x".repeat(199) + "\u{1F600}" + "y");
    expect(Array.from(out)).toHaveLength(200);
    expect(out.endsWith("\u{1F600}")).toBe(true);
  });
});
