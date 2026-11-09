import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/security/permissions";
import { conversationRepo } from "@/repositories/conversations";

import { GET as GET_ONE, PATCH } from "./[id]/route";
import { GET as GET_MESSAGES, POST as POST_MESSAGE } from "./[id]/messages/route";
import { GET } from "./route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

const BASE = "http://localhost/api/inbox/conversations";

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
): Request {
  const init: RequestInit = {
    method,
    headers: {
      origin: "http://localhost",
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  };
  return new Request(url, init);
}

const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("Inbox API Routes", () => {
  beforeEach(() => {
    session = null;
  });

  it("requires authentication", async () => {
    const res = await GET(send("GET", BASE));
    expect(res.status).toBe(401);
  });

  it("allows viewer to read conversations but denies modifying", async () => {
    const viewer = await seed("viewer");
    signIn(viewer.uid);

    const conv = await conversationRepo.create(viewer.organizationId, {
      channel: "whatsapp",
      contactPhoneE164: "+8801700000001",
      contactName: "Viewer Contact",
      customerId: null,
      assignedAgentId: null,
      assignedUserId: null,
      status: "needs_reply",
      unreadCount: 1,
      lastMessage: null,
      lastActivityAt: new Date().toISOString(),
      searchLower: "viewer contact +8801700000001",
    });

    // GET list -> 200
    const listRes = await GET(send("GET", BASE));
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.items.length).toBeGreaterThanOrEqual(1);

    // GET one -> 200
    const oneRes = await GET_ONE(send("GET", `${BASE}/${conv.id}`), idCtx(conv.id));
    expect(oneRes.status).toBe(200);

    // PATCH -> 403 (viewer lacks inbox:write)
    const patchRes = await PATCH(
      send("PATCH", `${BASE}/${conv.id}`, { status: "resolved" }),
      idCtx(conv.id),
    );
    expect(patchRes.status).toBe(403);

    // POST message -> 403
    const postRes = await POST_MESSAGE(
      send("POST", `${BASE}/${conv.id}/messages`, { text: "Hello" }),
      idCtx(conv.id),
    );
    expect(postRes.status).toBe(403);
  });

  it("allows agent (staff) to read and reply", async () => {
    const agent = await seed("agent");
    signIn(agent.uid);

    const conv = await conversationRepo.create(agent.organizationId, {
      channel: "whatsapp",
      contactPhoneE164: "+8801700000002",
      contactName: "Customer 2",
      customerId: null,
      assignedAgentId: null,
      assignedUserId: null,
      status: "needs_reply",
      unreadCount: 1,
      lastMessage: null,
      lastActivityAt: new Date().toISOString(),
      searchLower: "customer 2 +8801700000002",
    });

    // PATCH status -> 200
    const patchRes = await PATCH(
      send("PATCH", `${BASE}/${conv.id}`, { status: "human_handling" }),
      idCtx(conv.id),
    );
    expect(patchRes.status).toBe(200);

    // POST message -> 201
    const postRes = await POST_MESSAGE(
      send("POST", `${BASE}/${conv.id}/messages`, { text: "We have stock available!" }),
      idCtx(conv.id),
    );
    expect(postRes.status).toBe(201);
    const msg = await postRes.json();
    expect(msg.text).toBe("We have stock available!");
    expect(msg.sender).toBe("user");

    // GET messages -> 200
    const getMsgsRes = await GET_MESSAGES(
      send("GET", `${BASE}/${conv.id}/messages`),
      idCtx(conv.id),
    );
    expect(getMsgsRes.status).toBe(200);
    const msgsData = await getMsgsRes.json();
    expect(msgsData.items.length).toBe(1);
    expect(msgsData.items[0]?.id).toBe(msg.id);
  });
});
