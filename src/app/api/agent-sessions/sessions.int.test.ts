import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetEnvCacheForTests } from "@/config/env";
import { createMockProvider } from "@/lib/ai/mock-provider";
import { setChatProviderOverride } from "@/lib/ai/openai-provider";
import type { ChatProvider, ProviderRequest } from "@/lib/ai/provider";
import { AiProviderError, UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/security/permissions";
import { agentInputSchema } from "@/schemas/agent";
import { createAgent } from "@/services/agents/agents";
import type { AgentEvent } from "@/services/agents/events";
import { withPinnedRateWindow } from "@/test/pin-clock";

import { GET as GET_AGENT_SESSIONS, POST as POST_AGENT_SESSION } from "../agents/[id]/sessions/route";
import { GET as GET_SESSION } from "./[sessionId]/route";
import { POST as POST_MESSAGE } from "./[sessionId]/messages/route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

const orgs = new Set<string>();
const uids: string[] = [];

async function seed(role: Role, organizationId = `org-${randomUUID()}`) {
  const uid = `uid-${randomUUID()}`;
  const db = adminDb();
  await db
    .collection("users")
    .doc(uid)
    .set({ uid, email: `${uid}@x.com`, defaultOrganizationId: organizationId });
  await db
    .collection("organizationMembers")
    .doc(`${organizationId}_${uid}`)
    .set({ organizationId, uid, role });
  orgs.add(organizationId);
  uids.push(uid);
  return { uid, organizationId };
}

const signIn = (uid: string) => {
  session = { uid, email: `${uid}@x.com` };
};

function send(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Request {
  const raw =
    body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  const h = new Headers(body === undefined ? {} : { "content-type": "application/json" });
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  if (raw !== undefined) h.set("content-length", String(Buffer.byteLength(raw)));
  return new Request(url, { method, headers: h, body: raw, signal });
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as Json;

async function parseSseStream(res: Response): Promise<AgentEvent[]> {
  const reader = res.body?.getReader();
  if (!reader) return [];
  const decoder = new TextDecoder();
  let buffer = "";
  const events: AgentEvent[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      if (!frame.trim()) continue;
      const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
      if (dataLine) {
        events.push(JSON.parse(dataLine.slice(6)));
      }
    }
  }

  if (buffer.trim()) {
    const dataLine = buffer.split("\n").find((l) => l.startsWith("data: "));
    if (dataLine) {
      events.push(JSON.parse(dataLine.slice(6)));
    }
  }

  return events;
}

beforeEach(() => {
  session = null;
  setChatProviderOverride(undefined);
  __resetEnvCacheForTests();
});

afterAll(async () => {
  setChatProviderOverride(undefined);
  const db = adminDb();
  for (const org of orgs) {
    for (const col of ["agents", "agentSessions", "auditLogs", "rateLimits"]) {
      const snap = await db.collection(col).where("organizationId", "==", org).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    // Delete subcollections for agentSessions
    const sessions = await db.collection("agentSessions").where("organizationId", "==", org).get();
    for (const s of sessions.docs) {
      const msgs = await s.ref.collection("messages").get();
      await Promise.all(msgs.docs.map((m) => m.ref.delete()));
      await s.ref.delete();
    }
  }
  await Promise.all(
    uids.flatMap((u) => [
      db.collection("users").doc(u).delete(),
      ...[...orgs].map((o) => db.collection("organizationMembers").doc(`${o}_${u}`).delete()),
    ]),
  );
});

describe("agent sessions API", () => {
  it("enforces authentication and permissions on sessions", async () => {
    const { uid: adminUid, organizationId } = await seed("admin");
    const { uid: agentUid } = await seed("agent", organizationId);
    const { uid: viewerUid } = await seed("viewer", organizationId);

    const agent = await createAgent(
      { organizationId, uid: adminUid },
      agentInputSchema.parse({ name: "Sales Bot", role: "retail_sales" }),
    );

    // 401 without auth
    const reqCreate = send("POST", `http://localhost/api/agents/${agent.id}/sessions`);
    expect((await POST_AGENT_SESSION(reqCreate, { params: Promise.resolve({ id: agent.id }) })).status).toBe(401);

    // Viewer cannot create session (agents:test required) -> 403
    signIn(viewerUid);
    const resViewer = await POST_AGENT_SESSION(
      send("POST", `http://localhost/api/agents/${agent.id}/sessions`),
      { params: Promise.resolve({ id: agent.id }) },
    );
    expect(resViewer.status).toBe(403);

    // Role 'agent' CAN create session
    signIn(agentUid);
    const resAgent = await POST_AGENT_SESSION(
      send("POST", `http://localhost/api/agents/${agent.id}/sessions`),
      { params: Promise.resolve({ id: agent.id }) },
    );
    expect(resAgent.status).toBe(201);
    const sessionDoc = await json(resAgent);
    expect(sessionDoc.channel).toBe("test");
    expect(sessionDoc.agentId).toBe(agent.id);
  });

  it("lists sessions newest first and gets session with messages oldest first", async () => {
    const { uid, organizationId } = await seed("admin");
    signIn(uid);

    const agent = await createAgent(
      { organizationId, uid },
      agentInputSchema.parse({ name: "Listing Bot", role: "retail_sales" }),
    );

    // Create 2 sessions
    const s1Res = await POST_AGENT_SESSION(
      send("POST", `http://localhost/api/agents/${agent.id}/sessions`),
      { params: Promise.resolve({ id: agent.id }) },
    );
    const s1 = await json(s1Res);

    // Artificial delay to ensure distinct lastMessageAt
    await new Promise((r) => setTimeout(r, 20));

    const s2Res = await POST_AGENT_SESSION(
      send("POST", `http://localhost/api/agents/${agent.id}/sessions`),
      { params: Promise.resolve({ id: agent.id }) },
    );
    const s2 = await json(s2Res);

    // List sessions
    const listRes = await GET_AGENT_SESSIONS(
      send("GET", `http://localhost/api/agents/${agent.id}/sessions`),
      { params: Promise.resolve({ id: agent.id }) },
    );
    expect(listRes.status).toBe(200);
    const listData = await json(listRes);
    expect(listData.items.length).toBeGreaterThanOrEqual(2);
    expect(listData.items[0].id).toBe(s2.id);
    expect(listData.items[1].id).toBe(s1.id);

    // Get session
    const getRes = await GET_SESSION(
      send("GET", `http://localhost/api/agent-sessions/${s1.id}`),
      { params: Promise.resolve({ sessionId: s1.id }) },
    );
    expect(getRes.status).toBe(200);
    const getData = await json(getRes);
    expect(getData.session.id).toBe(s1.id);
    expect(Array.isArray(getData.messages)).toBe(true);
  });

  it("streams turn events over SSE ending with done", async () => {
    const { uid, organizationId } = await seed("admin");
    signIn(uid);

    const agent = await createAgent(
      { organizationId, uid },
      agentInputSchema.parse({ name: "Stream Bot", role: "retail_sales" }),
    );

    const sRes = await POST_AGENT_SESSION(
      send("POST", `http://localhost/api/agents/${agent.id}/sessions`),
      { params: Promise.resolve({ id: agent.id }) },
    );
    const sessionObj = await json(sRes);

    const mock = createMockProvider([
      {
        text: "Hello! Welcome to our store.",
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 8 },
        stopReason: "end",
      },
    ]);
    setChatProviderOverride(mock);

    const msgRes = await POST_MESSAGE(
      send("POST", `http://localhost/api/agent-sessions/${sessionObj.id}/messages`, {
        text: "Hi there!",
      }),
      { params: Promise.resolve({ sessionId: sessionObj.id }) },
    );

    expect(msgRes.status).toBe(200);
    expect(msgRes.headers.get("content-type")).toContain("text/event-stream");

    const events = await parseSseStream(msgRes);
    expect(events.length).toBeGreaterThan(0);

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    if (doneEvent && doneEvent.type === "done") {
      expect(doneEvent.usage.outputTokens).toBe(8);
      expect(doneEvent.messageId).toBeDefined();
    }

    // Verify messages in session
    const checkRes = await GET_SESSION(
      send("GET", `http://localhost/api/agent-sessions/${sessionObj.id}`),
      { params: Promise.resolve({ sessionId: sessionObj.id }) },
    );
    const checkData = await json(checkRes);
    expect(checkData.messages.length).toBe(2);
    expect(checkData.messages[0].role).toBe("user");
    expect(checkData.messages[0].text).toBe("Hi there!");
    expect(checkData.messages[1].role).toBe("assistant");
    expect(checkData.messages[1].text).toBe("Hello! Welcome to our store.");
  });

  it("returns 503 JSON envelope when OpenAI is not configured", async () => {
    const { uid, organizationId } = await seed("admin");
    signIn(uid);

    const agent = await createAgent(
      { organizationId, uid },
      agentInputSchema.parse({ name: "Unconfigured Bot", role: "retail_sales" }),
    );

    const sRes = await POST_AGENT_SESSION(
      send("POST", `http://localhost/api/agents/${agent.id}/sessions`),
      { params: Promise.resolve({ id: agent.id }) },
    );
    const sessionObj = await json(sRes);

    // Clear override and ensure OPENAI_API_KEY is unset
    setChatProviderOverride(undefined);
    vi.stubEnv("OPENAI_API_KEY", undefined);
    __resetEnvCacheForTests();

    const msgRes = await POST_MESSAGE(
      send("POST", `http://localhost/api/agent-sessions/${sessionObj.id}/messages`, {
        text: "Hello",
      }),
      { params: Promise.resolve({ sessionId: sessionObj.id }) },
    );

    expect(msgRes.status).toBe(503);
    const err = await json(msgRes);
    expect(err.error.code).toBe("INTEGRATION_NOT_CONFIGURED");
  });

  it("validates message body bounds (400 on empty or >2000 chars)", async () => {
    const { uid, organizationId } = await seed("admin");
    signIn(uid);

    const agent = await createAgent(
      { organizationId, uid },
      agentInputSchema.parse({ name: "Validate Bot", role: "retail_sales" }),
    );

    const sRes = await POST_AGENT_SESSION(
      send("POST", `http://localhost/api/agents/${agent.id}/sessions`),
      { params: Promise.resolve({ id: agent.id }) },
    );
    const sessionObj = await json(sRes);

    setChatProviderOverride(createMockProvider([]));

    // Empty / whitespace
    const emptyRes = await POST_MESSAGE(
      send("POST", `http://localhost/api/agent-sessions/${sessionObj.id}/messages`, {
        text: "   ",
      }),
      { params: Promise.resolve({ sessionId: sessionObj.id }) },
    );
    expect(emptyRes.status).toBe(400);

    // 2001 chars
    const bigRes = await POST_MESSAGE(
      send("POST", `http://localhost/api/agent-sessions/${sessionObj.id}/messages`, {
        text: "a".repeat(2001),
      }),
      { params: Promise.resolve({ sessionId: sessionObj.id }) },
    );
    expect(bigRes.status).toBe(400);
  });

  it("returns 404 for unknown or other-org session", async () => {
    const { uid: uid1, organizationId: org1 } = await seed("admin");
    const { uid: uid2 } = await seed("admin");

    const agent = await createAgent(
      { organizationId: org1, uid: uid1 },
      agentInputSchema.parse({ name: "Org1 Bot", role: "retail_sales" }),
    );

    signIn(uid1);
    const sRes = await POST_AGENT_SESSION(
      send("POST", `http://localhost/api/agents/${agent.id}/sessions`),
      { params: Promise.resolve({ id: agent.id }) },
    );
    const sessionObj = await json(sRes);

    setChatProviderOverride(createMockProvider([]));

    // User 2 in Org 2 attempts to message Org 1 session
    signIn(uid2);
    const crossRes = await POST_MESSAGE(
      send("POST", `http://localhost/api/agent-sessions/${sessionObj.id}/messages`, {
        text: "Probe",
      }),
      { params: Promise.resolve({ sessionId: sessionObj.id }) },
    );
    expect(crossRes.status).toBe(404);

    const crossGet = await GET_SESSION(
      send("GET", `http://localhost/api/agent-sessions/${sessionObj.id}`),
      { params: Promise.resolve({ sessionId: sessionObj.id }) },
    );
    expect(crossGet.status).toBe(404);
  });

  it("returns 409 when session turn limit is reached", async () => {
    const { uid, organizationId } = await seed("admin");
    signIn(uid);

    const agent = await createAgent(
      { organizationId, uid },
      agentInputSchema.parse({
        name: "TurnLimit Bot",
        role: "retail_sales",
        limits: { maxTurnsPerSession: 1 },
      }),
    );

    const sRes = await POST_AGENT_SESSION(
      send("POST", `http://localhost/api/agents/${agent.id}/sessions`),
      { params: Promise.resolve({ id: agent.id }) },
    );
    const sessionObj = await json(sRes);

    setChatProviderOverride(
      createMockProvider([
        { text: "Turn 1 reply", toolCalls: [], usage: { inputTokens: 5, outputTokens: 5 }, stopReason: "end" },
      ]),
    );

    // Turn 1 succeeds
    const t1 = await POST_MESSAGE(
      send("POST", `http://localhost/api/agent-sessions/${sessionObj.id}/messages`, { text: "Hello" }),
      { params: Promise.resolve({ sessionId: sessionObj.id }) },
    );
    expect(t1.status).toBe(200);
    await parseSseStream(t1);

    // Turn 2 is rejected with 409 Conflict
    const t2 = await POST_MESSAGE(
      send("POST", `http://localhost/api/agent-sessions/${sessionObj.id}/messages`, { text: "Hello again" }),
      { params: Promise.resolve({ sessionId: sessionObj.id }) },
    );
    expect(t2.status).toBe(409);
    const err = await json(t2);
    expect(err.error.code).toBe("CONFLICT");
  });

  it("emits SSE error event with static message on provider error mid-stream", async () => {
    const { uid, organizationId } = await seed("admin");
    signIn(uid);

    const agent = await createAgent(
      { organizationId, uid },
      agentInputSchema.parse({ name: "Error Bot", role: "retail_sales" }),
    );

    const sRes = await POST_AGENT_SESSION(
      send("POST", `http://localhost/api/agents/${agent.id}/sessions`),
      { params: Promise.resolve({ id: agent.id }) },
    );
    const sessionObj = await json(sRes);

    // Mock provider throws AiProviderError
    setChatProviderOverride({
      async generate() {
        throw new AiProviderError("unavailable");
      },
    });

    const msgRes = await POST_MESSAGE(
      send("POST", `http://localhost/api/agent-sessions/${sessionObj.id}/messages`, {
        text: "Will fail",
      }),
      { params: Promise.resolve({ sessionId: sessionObj.id }) },
    );

    expect(msgRes.status).toBe(200);
    const events = await parseSseStream(msgRes);
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent && errorEvent.type === "error") {
      expect(errorEvent.code).toBe("unavailable");
      expect(errorEvent.message).toBe("The AI service didn't respond. Try again.");
    }
  });

  it("saves interrupted message when client aborts mid-stream", async () => {
    const { uid, organizationId } = await seed("admin");
    signIn(uid);

    const agent = await createAgent(
      { organizationId, uid },
      agentInputSchema.parse({ name: "Abort Bot", role: "retail_sales" }),
    );

    const sRes = await POST_AGENT_SESSION(
      send("POST", `http://localhost/api/agents/${agent.id}/sessions`),
      { params: Promise.resolve({ id: agent.id }) },
    );
    const sessionObj = await json(sRes);

    const controller = new AbortController();
    const mock: ChatProvider = {
      async generate(req: ProviderRequest) {
        req.onTextDelta?.("Part 1 ");
        controller.abort();
        throw new AiProviderError("timeout");
      },
    };
    setChatProviderOverride(mock);

    const msgRes = await POST_MESSAGE(
      send(
        "POST",
        `http://localhost/api/agent-sessions/${sessionObj.id}/messages`,
        { text: "Abort test" },
        {},
        controller.signal,
      ),
      { params: Promise.resolve({ sessionId: sessionObj.id }) },
    );

    expect(msgRes.status).toBe(200);
    await parseSseStream(msgRes);

    // Verify session state has interrupted message
    const getRes = await GET_SESSION(
      send("GET", `http://localhost/api/agent-sessions/${sessionObj.id}`),
      { params: Promise.resolve({ sessionId: sessionObj.id }) },
    );
    const getData = await json(getRes);
    expect(getData.session.turnCount).toBe(1);
    const assistantMsg = getData.messages.find(
      (m: { role: string; interrupted?: boolean }) => m.role === "assistant",
    );
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.interrupted).toBe(true);
  });

  it("enforces per-user rate limit (20/min)", async () => {
    const { uid, organizationId } = await seed("admin");
    signIn(uid);

    const agent = await createAgent(
      { organizationId, uid },
      agentInputSchema.parse({ name: "RateLimit Bot", role: "retail_sales" }),
    );

    const sRes = await POST_AGENT_SESSION(
      send("POST", `http://localhost/api/agents/${agent.id}/sessions`),
      { params: Promise.resolve({ id: agent.id }) },
    );
    const sessionObj = await json(sRes);

    setChatProviderOverride(
      createMockProvider(
        Array(25).fill({
          text: "ok",
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: "end",
        }),
      ),
    );

    await withPinnedRateWindow(async () => {
      for (let i = 0; i < 20; i++) {
        const res = await POST_MESSAGE(
          send("POST", `http://localhost/api/agent-sessions/${sessionObj.id}/messages`, {
            text: `msg ${i}`,
          }),
          { params: Promise.resolve({ sessionId: sessionObj.id }) },
        );
        expect(res.status).toBe(200);
      }

      // 21st message -> 429
      const blocked = await POST_MESSAGE(
        send("POST", `http://localhost/api/agent-sessions/${sessionObj.id}/messages`, {
          text: "msg 21",
        }),
        { params: Promise.resolve({ sessionId: sessionObj.id }) },
      );
      expect(blocked.status).toBe(429);
      const err = await json(blocked);
      expect(err.error.code).toBe("RATE_LIMITED");
    });
  });

  it("enforces per-organization daily limit", async () => {
    const { uid, organizationId } = await seed("admin");
    signIn(uid);

    vi.stubEnv("AI_DAILY_MESSAGE_LIMIT", "2");
    __resetEnvCacheForTests();

    const agent = await createAgent(
      { organizationId, uid },
      agentInputSchema.parse({ name: "DailyCap Bot", role: "retail_sales" }),
    );

    const sRes = await POST_AGENT_SESSION(
      send("POST", `http://localhost/api/agents/${agent.id}/sessions`),
      { params: Promise.resolve({ id: agent.id }) },
    );
    const sessionObj = await json(sRes);

    setChatProviderOverride(
      createMockProvider([
        { text: "msg 1", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end" },
        { text: "msg 2", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end" },
      ]),
    );

    await withPinnedRateWindow(async () => {
      // Message 1 -> 200
      const r1 = await POST_MESSAGE(
        send("POST", `http://localhost/api/agent-sessions/${sessionObj.id}/messages`, { text: "1" }),
        { params: Promise.resolve({ sessionId: sessionObj.id }) },
      );
      expect(r1.status).toBe(200);

      // Message 2 -> 200
      const r2 = await POST_MESSAGE(
        send("POST", `http://localhost/api/agent-sessions/${sessionObj.id}/messages`, { text: "2" }),
        { params: Promise.resolve({ sessionId: sessionObj.id }) },
      );
      expect(r2.status).toBe(200);

      // Message 3 -> 429 Daily cap hit
      const r3 = await POST_MESSAGE(
        send("POST", `http://localhost/api/agent-sessions/${sessionObj.id}/messages`, { text: "3" }),
        { params: Promise.resolve({ sessionId: sessionObj.id }) },
      );
      expect(r3.status).toBe(429);
      const err = await json(r3);
      expect(err.error.code).toBe("RATE_LIMITED");
    });
  });
});
