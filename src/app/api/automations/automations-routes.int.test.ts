import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/security/permissions";
import { customerRepo } from "@/repositories/customers";

process.env.ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { GET as LIST_RULES, POST as CREATE_RULE } from "./route";
import { DELETE as DELETE_RULE, PATCH as PATCH_RULE } from "./[id]/route";
import { POST as TRIGGER_RULE } from "./[id]/trigger/route";
import { GET as LIST_RUNS, POST as RUN_SWEEP } from "./runs/route";
import { POST as INBOUND_WEBHOOK } from "../webhooks/automations/[ruleId]/route";

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
    name: "Automation Shop",
    slug: `auto-${organizationId}`,
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

describe("automations API routes (integration)", () => {
  it("handles rule CRUD, manual trigger, sweep run, run logs, and inbound n8n webhook", async () => {
    const { uid, organizationId } = await seedUser("owner");
    session = { uid, email: `${uid}@test.com` };

    const cust = await customerRepo.create(organizationId, {
      fullName: "Farhana Kabir",
      fullNameLower: "farhana kabir",
      phone: "+8801712340000",
      phoneE164: "+8801712340000",
      customerType: "retail",
      segment: "new_lead",
      tags: [],
      tagsLower: [],
      lastInteractionAt: null,
      totalSpendMinor: 0,
      consent: { status: "granted" },
    });

    // 1. Create inbound webhook automation rule
    const createRes = await CREATE_RULE(
      req("https://app.test/api/automations", "POST", {
        name: "n8n Follow-up Hook",
        trigger: "inbound_webhook",
        triggerConfig: {},
        action: "send_whatsapp",
        actionConfig: {
          messageTemplate: "Hi {{customerName}}, thanks for contacting us!",
        },
        webhookSecret: "route_hook_sec",
      }),
      { params: Promise.resolve({}) },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()).data as {
      id: string;
      hasWebhookSecret: boolean;
      inboundWebhookUrl: string;
    };
    expect(created.hasWebhookSecret).toBe(true);
    expect(created.inboundWebhookUrl).toBe(`/api/webhooks/automations/${created.id}`);

    // 2. List rules + templates
    const listRes = await LIST_RULES(req("https://app.test/api/automations"), {
      params: Promise.resolve({}),
    });
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.items).toHaveLength(1);
    expect(listJson.templates.length).toBeGreaterThanOrEqual(5);

    // 3. Patch rule description
    const patchRes = await PATCH_RULE(
      req(`https://app.test/api/automations/${created.id}`, "PATCH", {
        description: "Updated by test",
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(patchRes.status).toBe(200);

    // 4. Manual trigger on customer
    const triggerRes = await TRIGGER_RULE(
      req(`https://app.test/api/automations/${created.id}/trigger`, "POST", {
        customerId: cust.id,
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(triggerRes.status).toBe(200);
    const triggerRun = (await triggerRes.json()).data as { status: string; summary: string };
    expect(triggerRun.status).toBe("succeeded");

    // 5. Inbound n8n webhook authentication + execution
    const badHook = await INBOUND_WEBHOOK(
      req(
        `https://app.test/api/webhooks/automations/${created.id}`,
        "POST",
        { customerId: cust.id },
        { "x-n8n-secret": "bad" },
      ),
      { params: Promise.resolve({ ruleId: created.id }) },
    );
    expect(badHook.status).toBe(403);

    const goodHook = await INBOUND_WEBHOOK(
      req(
        `https://app.test/api/webhooks/automations/${created.id}`,
        "POST",
        { customerId: cust.id },
        { "x-n8n-secret": "route_hook_sec" },
      ),
      { params: Promise.resolve({ ruleId: created.id }) },
    );
    expect(goodHook.status).toBe(200);

    // 6. Sweep run & list run logs
    const sweepRes = await RUN_SWEEP(
      req("https://app.test/api/automations/runs", "POST"),
      { params: Promise.resolve({}) },
    );
    expect(sweepRes.status).toBe(200);

    const runsRes = await LIST_RUNS(req("https://app.test/api/automations/runs"), {
      params: Promise.resolve({}),
    });
    expect(runsRes.status).toBe(200);
    expect((await runsRes.json()).items).toHaveLength(2);

    // 7. Delete rule
    const delRes = await DELETE_RULE(
      req(`https://app.test/api/automations/${created.id}`, "DELETE"),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(delRes.status).toBe(200);
  });
});
