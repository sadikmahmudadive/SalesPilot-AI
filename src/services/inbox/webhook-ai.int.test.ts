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

  it("starts a new session when the stored one is escalated", async () => {
    const wa = newWaPhone();
    const provider = createMockProvider([text("First reply."), text("Second reply.")]);
    const { client } = fakeClient();
    const deps = { whatsappClient: client, engineDeps: { provider }, resolveOrgId: async () => ORG };

    await processWhatsAppWebhook(inbound(wa, "Hi"), deps);
    const first = (await conversationOf(wa))!.get("agentSessionId") as string;
    await db().collection("agentSessions").doc(first).update({ status: "escalated" });
    await processWhatsAppWebhook(inbound(wa, "Hello again"), deps);

    const second = (await conversationOf(wa))!.get("agentSessionId") as string;
    expect(second).not.toBe(first);
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
