import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { NotFoundError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { AGENT_SESSIONS } from "@/repositories/agent-sessions";
import { agentInputSchema } from "@/schemas/agent";

import { createAgent, type AgentCtx } from "./agents";
import {
  createSession,
  getSessionWithMessages,
  listSessions,
  markEscalated,
} from "./sessions";

const orgs: string[] = [];
function newCtx(): AgentCtx {
  const organizationId = `org-${randomUUID()}`;
  orgs.push(organizationId);
  return { organizationId, uid: `uid-${randomUUID()}` };
}

const make = (over: Record<string, unknown> = {}) =>
  agentInputSchema.parse({ name: "Sess Agent", role: "retail_sales", ...over });

afterAll(async () => {
  const db = adminDb();
  await Promise.all(
    orgs.flatMap(async (org) => {
      for (const col of ["agents", AGENT_SESSIONS]) {
        const snap = await db.collection(col).where("organizationId", "==", org).get();
        await Promise.all(snap.docs.map((d) => db.recursiveDelete(d.ref)));
      }
    }),
  );
}, 60_000);

describe("agent sessions service (integration)", () => {
  it("creates, retrieves, lists and escalates sessions", async () => {
    const ctxA = newCtx();
    const ctxB = newCtx();

    // Create an agent in org A
    const agent = await createAgent(ctxA, make({ status: "inactive" }));

    // 1. Create session
    const session = await createSession(ctxA, agent.id, "test");
    expect(session.id).toBeDefined();
    expect(session.organizationId).toBe(ctxA.organizationId);
    expect(session.agentId).toBe(agent.id);
    expect(session.agentVersion).toBe(1);
    expect(session.status).toBe("open");
    expect(session.turnCount).toBe(0);
    expect(session.channel).toBe("test");

    // Cross-org session creation throws NotFound
    await expect(createSession(ctxB, agent.id)).rejects.toThrow(NotFoundError);

    // 2. Add sample messages directly to subcollection
    const sessionRef = adminDb().collection(AGENT_SESSIONS).doc(session.id);
    await sessionRef.collection("messages").doc("m1").set({
      organizationId: ctxA.organizationId,
      sessionId: session.id,
      role: "user",
      text: "Hi!",
      createdAt: "2026-11-09T10:00:00.000Z",
    });
    await sessionRef.collection("messages").doc("m2").set({
      organizationId: ctxA.organizationId,
      sessionId: session.id,
      role: "assistant",
      text: "Hello, how can I help you?",
      createdAt: "2026-11-09T10:00:05.000Z",
    });

    // 3. getSessionWithMessages returns session and messages in order
    const loaded = await getSessionWithMessages(ctxA, session.id);
    expect(loaded.session.id).toBe(session.id);
    expect(loaded.messages.length).toBe(2);
    expect(loaded.messages[0]!.id).toBe("m1");
    expect(loaded.messages[0]!.role).toBe("user");
    expect(loaded.messages[1]!.id).toBe("m2");
    expect(loaded.messages[1]!.role).toBe("assistant");

    // Cross-org read throws NotFound
    await expect(getSessionWithMessages(ctxB, session.id)).rejects.toThrow(NotFoundError);

    // 4. listSessions
    const list = await listSessions(ctxA, agent.id, { limit: 10 });
    expect(list.items.length).toBe(1);
    expect(list.items[0]!.id).toBe(session.id);

    // Cross-org list throws NotFound for foreign agent
    await expect(listSessions(ctxB, agent.id)).rejects.toThrow(NotFoundError);

    // 5. markEscalated
    await markEscalated(ctxA, session.id, "User requested a manager");
    const reloaded = await getSessionWithMessages(ctxA, session.id);
    expect(reloaded.session.status).toBe("escalated");
    expect(reloaded.session.escalationReason).toBe("User requested a manager");

    // Cross-org escalation throws NotFound
    await expect(markEscalated(ctxB, session.id, "hack")).rejects.toThrow(NotFoundError);
  });
});
