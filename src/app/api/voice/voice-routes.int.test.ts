import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/security/permissions";

process.env.ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { POST as CREATE_VOICE_ACCOUNT, GET as LIST_VOICE_ACCOUNTS } from "../integrations/voice/route";
import { POST as TEST_VOICE_ACCOUNT } from "../integrations/voice/[id]/test/route";
import { POST as WEBHOOK_POST } from "../webhooks/voice/[provider]/[accountId]/route";
import { GET as GET_CALL, PATCH as PATCH_CALL } from "./calls/[id]/route";
import { GET as LIST_CALLS, POST as INITIATE_CALL } from "./calls/route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

async function seedUser(role: Role = "owner") {
  const organizationId = `org-${randomUUID()}`;
  const uid = `uid-${randomUUID()}`;
  const db = adminDb();
  await db.collection("organizations").doc(organizationId).set({
    id: organizationId,
    name: "Voice Shop",
    slug: `voice-${organizationId}`,
    ownerUid: uid,
    currency: "BDT",
    timezone: "Asia/Dhaka",
  });
  await db
    .collection("users")
    .doc(uid)
    .set({ uid, email: `${uid}@test.com`, defaultOrganizationId: organizationId });
  await db
    .collection("organizationMembers")
    .doc(`${organizationId}_${uid}`)
    .set({ organizationId, uid, role });
  return { uid, organizationId };
}

function req(url: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method,
    headers: {
      origin: "https://app.test",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("voice API routes (integration)", () => {
  it("creates, tests voice integration account, initiates call, receives webhook, and updates outcome", async () => {
    const { uid } = await seedUser("owner");
    session = { uid, email: `${uid}@test.com` };

    // 1. Create mock voice integration
    const createAccRes = await CREATE_VOICE_ACCOUNT(
      req("https://app.test/api/integrations/voice", "POST", {
        provider: "mock",
        label: "Mock Voice AI",
        mode: "mock",
        enabled: true,
        isDefault: true,
        credentials: {},
        webhookSecret: "sec_route_1",
        publicConfig: {},
      }),
      { params: Promise.resolve({}) },
    );
    expect(createAccRes.status).toBe(201);
    const createdAcc = (await createAccRes.json()).data as { id: string; webhookUrl: string };
    expect(createdAcc.webhookUrl).toBe(`/api/webhooks/voice/mock/${createdAcc.id}`);

    // 2. List & test connection
    const listAccRes = await LIST_VOICE_ACCOUNTS(
      req("https://app.test/api/integrations/voice"),
      { params: Promise.resolve({}) },
    );
    expect(listAccRes.status).toBe(200);
    expect((await listAccRes.json()).items).toHaveLength(1);

    const testAccRes = await TEST_VOICE_ACCOUNT(
      req(`https://app.test/api/integrations/voice/${createdAcc.id}/test`, "POST"),
      { params: Promise.resolve({ id: createdAcc.id }) },
    );
    expect(testAccRes.status).toBe(200);

    // 3. Initiate outbound call
    const callRes = await INITIATE_CALL(
      req("https://app.test/api/voice/calls", "POST", {
        phoneE164: "01712345678",
        purpose: "Confirm order",
      }),
      { params: Promise.resolve({}) },
    );
    expect(callRes.status, await callRes.clone().text()).toBe(201);
    const call = (await callRes.json()).data as { id: string; providerCallId: string; phoneE164: string };
    expect(call.phoneE164).toBe("+8801712345678");
    expect(call.providerCallId).toBe(`mock_call_${call.id}`);

    // 4. Receive end-of-call webhook
    const hookRes = await WEBHOOK_POST(
      req(
        `https://app.test/api/webhooks/voice/mock/${createdAcc.id}`,
        "POST",
        {
          providerCallId: call.providerCallId,
          status: "completed",
          durationSeconds: 25,
          summary: "Confirmed",
        },
        { "x-voice-secret": "sec_route_1" },
      ),
      { params: Promise.resolve({ provider: "mock", accountId: createdAcc.id }) },
    );
    expect(hookRes.status).toBe(200);

    // 5. Patch outcome & fetch call
    const patchRes = await PATCH_CALL(
      req(`https://app.test/api/voice/calls/${call.id}`, "PATCH", {
        outcome: "order_confirmed",
        notes: "Verified address",
      }),
      { params: Promise.resolve({ id: call.id }) },
    );
    expect(patchRes.status).toBe(200);

    const getRes = await GET_CALL(
      req(`https://app.test/api/voice/calls/${call.id}`),
      { params: Promise.resolve({ id: call.id }) },
    );
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).data).toMatchObject({
      status: "completed",
      outcome: "order_confirmed",
      durationSeconds: 25,
      notes: "Verified address",
    });

    const listCallsRes = await LIST_CALLS(
      req("https://app.test/api/voice/calls?direction=outbound"),
      { params: Promise.resolve({}) },
    );
    expect(listCallsRes.status).toBe(200);
    expect((await listCallsRes.json()).items).toHaveLength(1);
  });
});
