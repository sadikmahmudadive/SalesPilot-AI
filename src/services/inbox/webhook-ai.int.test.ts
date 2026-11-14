/**
 * The live WhatsApp path end to end through `processWhatsAppWebhook` with a scripted provider:
 * one agent session per conversation, redelivery dedup, and an AI order drafted in one customer
 * message and confirmed in the next (Ruling R19).
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { __resetEnvCacheForTests } from "@/config/env";
import { adminDb } from "@/lib/firebase/admin";
import { createMockProvider, type MockStep } from "@/lib/ai/mock-provider";
import type { WhatsAppWebhookPayload } from "@/lib/whatsapp/types";
import { agentInputSchema } from "@/schemas/agent";
import { productInputSchema } from "@/schemas/product";
import { createAgent } from "@/services/agents/agents";
import { adjustStock } from "@/services/inventory/stock";
import { createProduct } from "@/services/products/products";
import { saveWhatsAppConnection } from "@/services/whatsapp/connections";
import { fakeMeta } from "@/test/whatsapp-meta";

import { defaultResolveOrgId, processWhatsAppWebhook } from "./webhook-handler";

const db = () => adminDb();
const ORG = `org-${randomUUID()}`;
const ctx = { organizationId: ORG, uid: "uid-seed" };
const PHONE_NUMBER_ID = "pnid_test_1";

let agentId: string;
let productId: string;

const text = (t: string): MockStep => ({
  text: t,
  toolCalls: [],
  usage: { inputTokens: 1, outputTokens: 1 },
  stopReason: "end",
});
const toolCall = (name: string, args: unknown): MockStep => ({
  text: "",
  toolCalls: [{ id: `call-${randomUUID()}`, name, argumentsJson: JSON.stringify(args) }],
  usage: { inputTokens: 1, outputTokens: 1 },
  stopReason: "tool_calls",
});

let waCounter = 0;
// 880 + a 10-digit mobile (1714 + 6 digits): a valid BD number, so the CRM customer is created.
const newWaPhone = () => `8801714${String(1000000 + ++waCounter).slice(1)}`;

function inbound(from: string, body: string, id = `wamid.${randomUUID()}`): WhatsAppWebhookPayload {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "entry",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "+15550000000", phone_number_id: PHONE_NUMBER_ID },
              contacts: [{ profile: { name: "Karim" }, wa_id: from }],
              messages: [{ from, id, timestamp: "1794251000", type: "text", text: { body } }],
            },
          },
        ],
      },
    ],
  };
}

function fakeClient() {
  const sent: string[] = [];
  return {
    sent,
    client: {
      sendTextMessage: async (_to: string, body: string) => {
        sent.push(body);
        return { messageId: `wamid.out.${randomUUID()}` };
      },
      markMessageAsRead: async () => true,
    } as never,
  };
}

async function conversationOf(waPhone: string) {
  const snap = await db()
    .collection("conversations")
    .where("organizationId", "==", ORG)
    .where("contactPhoneE164", "==", `+${waPhone}`)
    .get();
  return snap.docs[0];
}

beforeAll(async () => {
  await db().collection("organizations").doc(ORG).set({ name: "Webhook AI Shop", ownerUid: "u1" });
  const agent = await createAgent(
    ctx,
    agentInputSchema.parse({
      name: "WhatsApp sales",
      role: "order_management",
      status: "active",
      channels: ["test", "whatsapp"],
      tools: ["create_draft_order", "confirm_order", "get_my_order_status"],
    }),
  );
  agentId = agent.id;
  const product = await createProduct(
    ctx,
    productInputSchema.parse({
      name: "Cotton panjabi",
      sku: `sku-${randomUUID().slice(0, 8)}`,
      regularPriceMinor: 150000,
      availability: "active",
    }),
  );
  productId = product.id;
  await adjustStock(ctx, productId, "default", { delta: 10, reason: "seed" });
});

afterAll(async () => {
  for (const col of [
    "conversations",
    "customers",
    "customerPhones",
    "orders",
    "agentSessions",
    "whatsappInbound",
  ]) {
    const snap = await db().collection(col).where("organizationId", "==", ORG).get();
    await Promise.all(snap.docs.map((d) => db().recursiveDelete(d.ref)));
  }
  await db().collection("organizations").doc(ORG).delete();
});

describe("WhatsApp AI conversations", () => {
  it("continues one agent session across customer messages, so the AI sees earlier turns", async () => {
    const wa = newWaPhone();
    const provider = createMockProvider([text("Hello, how can I help?"), text("Sure, one moment.")]);
    const { client, sent } = fakeClient();
    const deps = { whatsappClient: client, engineDeps: { provider }, resolveOrgId: async () => ORG };

    await processWhatsAppWebhook(inbound(wa, "Hi"), deps);
    await processWhatsAppWebhook(inbound(wa, "Do you have panjabi?"), deps);

    expect(sent).toEqual(["Hello, how can I help?", "Sure, one moment."]);
    const conv = (await conversationOf(wa))!;
    const sessionId = conv.get("agentSessionId") as string;
    expect(typeof sessionId).toBe("string");
    const sessions = await db()
      .collection("agentSessions")
      .where("organizationId", "==", ORG)
      .where("agentId", "==", agentId)
      .get();
    expect(sessions.docs.filter((d) => d.id === sessionId)).toHaveLength(1);
    expect((await db().collection("agentSessions").doc(sessionId).get()).get("turnCount")).toBe(2);
    // The second request carried the first exchange as history.
    const history = provider.calls[1]!.messages.map((m) => ("text" in m ? m.text : ""));
    expect(history).toContain("Hi");
    expect(history).toContain("Hello, how can I help?");
  });

  it("an escalation hands the conversation to a person and the AI stops answering", async () => {
    const wa = newWaPhone();
    const provider = createMockProvider([
      async () => {
        // What escalate_to_human does: mark the session escalated during the turn.
        const conv = (await conversationOf(wa))!;
        await db().collection("agentSessions").doc(conv.get("agentSessionId") as string).update({
          status: "escalated",
        });
        return {
          text: "Let me connect you with a person.",
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: "end",
        };
      },
    ]);
    const { client, sent } = fakeClient();
    const deps = { whatsappClient: client, engineDeps: { provider }, resolveOrgId: async () => ORG };

    await processWhatsAppWebhook(inbound(wa, "I want to talk to a person"), deps);
    const conv = (await conversationOf(wa))!;
    expect(conv.get("status")).toBe("needs_reply");
    expect(conv.get("agentSessionId")).toBeNull();

    await processWhatsAppWebhook(inbound(wa, "Hello?"), deps);
    expect(provider.calls).toHaveLength(1); // the AI did not answer the second message
    expect(sent).toEqual(["Let me connect you with a person."]);
  });

  it("answers a redelivered message only once", async () => {
    const wa = newWaPhone();
    const provider = createMockProvider([text("Only once.")]);
    const { client, sent } = fakeClient();
    const deps = { whatsappClient: client, engineDeps: { provider }, resolveOrgId: async () => ORG };
    const payload = inbound(wa, "Hi", `wamid.dup.${randomUUID()}`);

    const a = await processWhatsAppWebhook(payload, deps);
    const b = await processWhatsAppWebhook(payload, deps);

    expect(a.processedMessages).toBe(1);
    expect(b.processedMessages).toBe(0);
    expect(sent).toEqual(["Only once."]);
    const msgs = await (await conversationOf(wa))!.ref.collection("messages").get();
    expect(msgs.docs.filter((d) => d.get("direction") === "inbound")).toHaveLength(1);
  });

  it("confirms in the next message an order drafted in the previous one", async () => {
    const wa = newWaPhone();
    const draftArgs = {
      lines: [{ productId, quantity: 2 }],
      address: { recipientName: "Karim", line1: "House 5, Road 7", zone: "inside_dhaka" },
      paymentMethod: "cod",
    };
    const provider = createMockProvider([
      toolCall("create_draft_order", draftArgs),
      text("Here is your order summary. Shall I confirm it?"),
      toolCall("confirm_order", { customerConfirmed: true, confirmationQuote: "yes please" }),
      text("Your order is confirmed."),
    ]);
    const { client, sent } = fakeClient();
    const deps = { whatsappClient: client, engineDeps: { provider }, resolveOrgId: async () => ORG };

    await processWhatsAppWebhook(inbound(wa, "I want two panjabi, House 5, Road 7"), deps);
    await processWhatsAppWebhook(inbound(wa, "yes please"), deps);

    expect(sent).toEqual([
      "Here is your order summary. Shall I confirm it?",
      "Your order is confirmed.",
    ]);
    const conv = (await conversationOf(wa))!;
    const orders = await db()
      .collection("orders")
      .where("organizationId", "==", ORG)
      .where("customerId", "==", conv.get("customerId"))
      .get();
    expect(orders.docs).toHaveLength(1);
    const order = orders.docs[0]!;
    expect(order.get("status")).toBe("confirmed");
    expect(order.get("conversationId")).toBe(conv.id);
    const inventory = (await db().collection("inventory").doc(`${productId}__default`).get()).data();
    expect(inventory?.reserved).toBe(2);
  });
});

describe("two workspaces on one shared webhook", () => {
  const TEST_KEY = Buffer.alloc(32, 9).toString("base64");
  const orgB = `org-${randomUUID()}`;
  const NUM_A = `4${String(Date.now()).slice(-9)}`;
  const NUM_B = `5${String(Date.now()).slice(-9)}`;
  const TOKEN_A = "EAAG-token-of-workspace-A-000";
  const TOKEN_B = "EAAG-token-of-workspace-B-000";

  afterAll(async () => {
    for (const orgId of [ORG, orgB]) {
      await db().collection("whatsappConnections").doc(orgId).delete();
    }
    await db().collection("whatsappPhoneNumbers").doc(NUM_A).delete();
    await db().collection("whatsappPhoneNumbers").doc(NUM_B).delete();
    for (const col of ["conversations", "customers", "customerPhones", "agents", "agentSessions", "whatsappInbound"]) {
      const snap = await db().collection(col).where("organizationId", "==", orgB).get();
      await Promise.all(snap.docs.map((d) => db().recursiveDelete(d.ref)));
    }
    await db().collection("organizations").doc(orgB).delete();
    vi.unstubAllEnvs();
    __resetEnvCacheForTests();
  });

  it("routes each change to its own workspace", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    __resetEnvCacheForTests();
    await db().collection("organizations").doc(orgB).set({ name: "Shop B", ownerUid: "u2" });
    await createAgent(
      { organizationId: orgB, uid: "uid-b" },
      agentInputSchema.parse({
        name: "B sales",
        role: "order_management",
        status: "active",
        channels: ["test", "whatsapp"],
      }),
    );
    const fetchFn = fakeMeta({ [NUM_A]: TOKEN_A, [NUM_B]: TOKEN_B });
    await saveWhatsAppConnection(
      ctx,
      { phoneNumberId: NUM_A, businessAccountId: "1022901", accessToken: TOKEN_A, enabled: true },
      { fetchFn },
    );
    await saveWhatsAppConnection(
      { organizationId: orgB, uid: "uid-b" },
      { phoneNumberId: NUM_B, businessAccountId: "1022902", accessToken: TOKEN_B, enabled: true },
      { fetchFn },
    );
    const tokenOfSend = (number: string) =>
      fetchFn.sends.find((x) => x.phoneNumberId === number && x.body.includes('"type":"text"'))?.authorization;
    const provider = createMockProvider([text("Hello from A."), text("Hello from B.")]);
    const waA = newWaPhone();
    const waB = newWaPhone();
    const change = (pnid: string, from: string, body: string) => ({
      field: "messages",
      value: {
        messaging_product: "whatsapp" as const,
        metadata: { display_phone_number: "+15550000000", phone_number_id: pnid },
        contacts: [{ profile: { name: "Karim" }, wa_id: from }],
        messages: [{ from, id: `wamid.${randomUUID()}`, timestamp: "1794251000", type: "text" as const, text: { body } }],
      },
    });
    const payload: WhatsAppWebhookPayload = {
      object: "whatsapp_business_account",
      entry: [{ id: "entry", changes: [change(NUM_A, waA, "Hi A"), change(NUM_B, waB, "Hi B")] }],
    };

    // No resolveOrgId / whatsappClient override: real routing by number and real per-org clients.
    await processWhatsAppWebhook(payload, { engineDeps: { provider }, fetchFn });

    const convA = await conversationOf(waA);
    const convB = (
      await db().collection("conversations").where("organizationId", "==", orgB).get()
    ).docs.find((d) => d.get("contactPhoneE164") === `+${waB}`);
    expect(convA?.get("organizationId")).toBe(ORG);
    expect(convB).toBeDefined();
    expect(tokenOfSend(NUM_A)).toBe(`Bearer ${TOKEN_A}`);
    expect(tokenOfSend(NUM_B)).toBe(`Bearer ${TOKEN_B}`);
    expect(convB!.get("whatsappPhoneNumberId")).toBe(NUM_B);
  });

  it("still stores the message when the workspace's token cannot be decrypted", async () => {
    // A different key than the one the tokens were sealed with (a rotated or wrong ENCRYPTION_KEY).
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 4).toString("base64"));
    __resetEnvCacheForTests();
    const provider = createMockProvider([]);
    const wa = newWaPhone();
    const res = await processWhatsAppWebhook(
      {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "entry",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: { display_phone_number: "+15550000000", phone_number_id: NUM_A },
                  contacts: [{ profile: { name: "Karim" }, wa_id: wa }],
                  messages: [
                    { from: wa, id: `wamid.${randomUUID()}`, timestamp: "1794251000", type: "text", text: { body: "Hello" } },
                  ],
                },
              },
            ],
          },
        ],
      },
      { engineDeps: { provider }, resolveOrgId: async () => ORG },
    );
    expect(res.processedMessages).toBe(1);
    const conv = (await conversationOf(wa))!;
    expect(conv.get("status")).toBe("needs_reply");
    const msgs = await conv.ref.collection("messages").get();
    expect(msgs.size).toBe(1);
    expect(provider.calls).toHaveLength(0);
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    __resetEnvCacheForTests();
  });
});

describe("defaultResolveOrgId", () => {
  const stub = (vars: Record<string, string>) => {
    for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
    __resetEnvCacheForTests();
  };
  afterAll(() => {
    vi.unstubAllEnvs();
    __resetEnvCacheForTests();
  });

  it("returns the configured organization for the configured number only", async () => {
    stub({ WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID, WHATSAPP_ORGANIZATION_ID: ORG });
    expect(await defaultResolveOrgId(PHONE_NUMBER_ID)).toBe(ORG);
    expect(await defaultResolveOrgId("some_other_number")).toBeNull();
    expect(await defaultResolveOrgId(undefined)).toBeNull();
  });

  it("never falls back to another organization", async () => {
    stub({ WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID, WHATSAPP_ORGANIZATION_ID: "" });
    expect(await defaultResolveOrgId(PHONE_NUMBER_ID)).toBeNull();
    stub({ WHATSAPP_ORGANIZATION_ID: `org-missing-${randomUUID()}` });
    expect(await defaultResolveOrgId(PHONE_NUMBER_ID)).toBeNull();
  });
});
