import { randomUUID } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminDb } from "@/lib/firebase/admin";
import { formatMoneyMinor } from "@/lib/format";
import { agentInputSchema, type Agent, type AgentChannel, type ToolName } from "@/schemas/agent";
import { customerInputSchema } from "@/schemas/customer";
import { shippingAddressSchema } from "@/schemas/order";
import { categoryInputSchema, productInputSchema, type Product } from "@/schemas/product";
import { createCustomer } from "@/services/crm/customers";
import { adjustStock } from "@/services/inventory/stock";
import { createDraftOrder } from "@/services/orders/drafts";
import { createCategory } from "@/services/products/categories";
import { createProduct } from "@/services/products/products";

import { summarizeToolResult } from "../engine";
import { executeTool } from "./registry";
import type { DryRunAction, ToolContext, ToolOutcome } from "./types";

const db = () => adminDb();
const orgs: string[] = [];
const newOrg = () => {
  const id = `org-${randomUUID()}`;
  orgs.push(id);
  return id;
};
const ORG = newOrg();
const seedCtx = { organizationId: ORG, uid: "uid-seed" };

const ORDER_TOOLS: ToolName[] = [
  "create_draft_order",
  "update_draft_order",
  "confirm_order",
  "get_my_order_status",
  "calculate_order_total",
];

let counter = 0;
function makeAgent(over: Record<string, unknown> = {}): Agent {
  counter += 1;
  return {
    ...agentInputSchema.parse({
      name: `Order agent ${counter}`,
      role: "order_management",
      tools: ORDER_TOOLS,
      ...over,
    }),
    id: `agent-${counter}`,
    organizationId: ORG,
    version: 1,
    createdBy: "uid-seed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

let phoneCounter = 0;
const newPhone = () => `01713${String(1000000 + ++phoneCounter).slice(1)}`;
const e164 = (local: string) => `+880${local.slice(1)}`;

/** A live (WhatsApp) context for a fresh session, bound to `phone`. */
function liveCtx(agent: Agent, phone: string | undefined, sessionId = `s-${randomUUID()}`) {
  const ctx: ToolContext = {
    organizationId: ORG,
    agent,
    sessionId,
    channel: "whatsapp",
    actorUid: "uid-seed",
  };
  if (phone !== undefined) ctx.contactPhoneE164 = e164(phone);
  return ctx;
}

const testCtx = (agent: Agent, channel: AgentChannel = "test"): ToolContext => ({
  organizationId: ORG,
  agent,
  sessionId: `s-${randomUUID()}`,
  channel,
  actorUid: "uid-seed",
});

const call = (ctx: ToolContext, name: string, args: unknown): Promise<ToolOutcome<unknown>> =>
  executeTool(ctx, name, JSON.stringify(args));

function okOf(r: ToolOutcome<unknown>) {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r as { ok: true; data: Record<string, unknown>; dryRunAction?: DryRunAction };
}

async function docsOf(collection: string) {
  return (await db().collection(collection).where("organizationId", "==", ORG).get()).docs;
}
async function ordersOf(customerId: string) {
  return (
    await db()
      .collection("orders")
      .where("organizationId", "==", ORG)
      .where("customerId", "==", customerId)
      .get()
  ).docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown> & { id: string });
}
async function reservedOf(productId: string, variantId = "default") {
  const d = (await db().collection("inventory").doc(`${productId}__${variantId}`).get()).data();
  return (d?.reserved as number | undefined) ?? 0;
}

const address = {
  recipientName: "Rahim",
  line1: "House 1, Road 2",
  area: "Dhanmondi",
  zone: "inside_dhaka",
};

let shirt: Product; // apparel, 50000 paisa, 50 in stock
let cap: Product; // apparel, 20000 paisa, 50 in stock
let gadget: Product; // electronics (out of scope for the apparel-only agent), 5 in stock
let apparelId: string;

async function seedProduct(name: string, price: number, categoryId: string, stock: number) {
  const product = await createProduct(
    seedCtx,
    productInputSchema.parse({
      name,
      sku: `sku-${randomUUID().slice(0, 8)}`,
      regularPriceMinor: price,
      categoryId,
      availability: "active",
    }),
  );
  await adjustStock(seedCtx, product.id, "default", { delta: stock, reason: "seed" });
  return product;
}

async function seedContact() {
  const phone = newPhone();
  const customer = await createCustomer(
    seedCtx,
    customerInputSchema.parse({ fullName: "Md. Rahim", phone }),
  );
  return { phone, customer };
}

beforeAll(async () => {
  const apparel = await createCategory(seedCtx, categoryInputSchema.parse({ name: "Apparel" }));
  const electronics = await createCategory(
    seedCtx,
    categoryInputSchema.parse({ name: "Electronics" }),
  );
  apparelId = apparel.id;
  shirt = await seedProduct("Blue Shirt", 50000, apparel.id, 50);
  cap = await seedProduct("Red Cap", 20000, apparel.id, 50);
  gadget = await seedProduct("Phone Charger", 90000, electronics.id, 5);
});

afterAll(async () => {
  for (const d of await docsOf("inventory")) await db().recursiveDelete(d.ref);
  for (const col of [
    "orders",
    "orderEvents",
    "orderCounters",
    "orderNumbers",
    "orderIdempotency",
    "orderSettings",
    "auditLogs",
    "products",
    "productSkus",
    "productSlugs",
    "categories",
    "categorySlugs",
    "customers",
    "customerPhones",
  ]) {
    const docs = await docsOf(col);
    await Promise.all(docs.map((d) => d.ref.delete()));
  }
}, 120_000);

const createArgs = (lines: Array<{ productId: string; quantity: number }>, over = {}) => ({
  lines,
  address,
  paymentMethod: "cod",
  ...over,
});

describe("create_draft_order on the test channel (dry run)", () => {
  it("prices the draft and writes nothing: no order, no reservation", async () => {
    const before = await reservedOf(shirt.id);
    const r = okOf(
      await call(
        testCtx(makeAgent()),
        "create_draft_order",
        createArgs([{ productId: shirt.id, quantity: 2 }]),
      ),
    );
    expect(r.data).toEqual({
      orderNumber: "DRAFT-PREVIEW",
      lines: [{ name: "Blue Shirt", quantity: 2, lineTotalText: formatMoneyMinor(100000) }],
      subtotalText: formatMoneyMinor(100000),
      deliveryChargeText: formatMoneyMinor(6000),
      totalText: formatMoneyMinor(106000),
      paymentMethod: "cod",
      holdMinutes: 30,
    });
    expect(r.dryRunAction).toMatchObject({ kind: "create_order" });
    expect(await docsOf("orders")).toHaveLength(0);
    expect(await docsOf("orderEvents")).toHaveLength(0);
    expect(await reservedOf(shirt.id)).toBe(before);
  });

  it("still checks stock read-only and the agent's product scope", async () => {
    const ctx = testCtx(makeAgent());
    expect(
      await call(ctx, "create_draft_order", createArgs([{ productId: gadget.id, quantity: 6 }])),
    ).toEqual({ ok: false, code: "invalid", message: "One item is out of stock." });
    const scoped = testCtx(
      makeAgent({ productAccess: { mode: "categories", categoryIds: [apparelId] } }),
    );
    expect(
      await call(scoped, "create_draft_order", createArgs([{ productId: gadget.id, quantity: 1 }])),
    ).toEqual({ ok: false, code: "invalid", message: "One item isn't available." });
  });
});

describe("create_draft_order on a live channel", () => {
  it("creates a held AI draft for the contact customer, recipient phone = contact", async () => {
    const { phone, customer } = await seedContact();
    const agent = makeAgent();
    const ctx = liveCtx(agent, phone);
    const before = await reservedOf(shirt.id);
    const r = okOf(
      await call(ctx, "create_draft_order", createArgs([{ productId: shirt.id, quantity: 2 }])),
    );
    const orders = await ordersOf(customer.id);
    expect(orders).toHaveLength(1);
    const order = orders[0]!;
    expect(order).toMatchObject({
      status: "draft",
      source: "ai",
      createdBy: { kind: "ai", agentId: agent.id, sessionId: ctx.sessionId },
      customerId: customer.id,
      stockState: "held",
      shippingAddress: { recipientName: "Rahim", phoneE164: e164(phone), zone: "inside_dhaka" },
      discountMinor: 0,
    });
    expect(r.data).toMatchObject({
      orderNumber: order.orderNumber,
      totalText: formatMoneyMinor(106000),
      paymentMethod: "cod",
    });
    expect(r.data.holdMinutes).toBeGreaterThanOrEqual(29);
    expect(r.data.holdMinutes).toBeLessThanOrEqual(30);
    expect(r.dryRunAction).toBeUndefined();
    expect(await reservedOf(shirt.id)).toBe(before + 2);
    expect(summarizeToolResult("create_draft_order", r)).toBe(
      `Draft ${String(order.orderNumber)}: total ${formatMoneyMinor(106000)}`,
    );
  });

  it("same idempotency key returns the same order (one order, reserved once)", async () => {
    const { phone, customer } = await seedContact();
    const ctx = liveCtx(makeAgent(), phone);
    const args = createArgs([{ productId: cap.id, quantity: 3 }]);
    const before = await reservedOf(cap.id);
    const first = okOf(await call(ctx, "create_draft_order", args));
    const second = okOf(await call(ctx, "create_draft_order", args));
    expect(second.data.orderNumber).toBe(first.data.orderNumber);
    const orders = await ordersOf(customer.id);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.revision).toBe(1);
    expect(await reservedOf(cap.id)).toBe(before + 3);
  });

  it("parallel identical calls in one session still make one order", async () => {
    const { phone, customer } = await seedContact();
    const ctx = liveCtx(makeAgent(), phone);
    const args = createArgs([{ productId: cap.id, quantity: 1 }]);
    const before = await reservedOf(cap.id);
    const [a, b] = await Promise.all([
      call(ctx, "create_draft_order", args),
      call(ctx, "create_draft_order", args),
    ]);
    expect(okOf(a).data.orderNumber).toBe(okOf(b).data.orderNumber);
    expect(await ordersOf(customer.id)).toHaveLength(1);
    expect(await reservedOf(cap.id)).toBe(before + 1);
  });

  it("a second create with different lines updates the open draft (revision 2)", async () => {
    const { phone, customer } = await seedContact();
    const ctx = liveCtx(makeAgent(), phone);
    const first = okOf(
      await call(ctx, "create_draft_order", createArgs([{ productId: shirt.id, quantity: 1 }])),
    );
    const capBefore = await reservedOf(cap.id);
    const second = okOf(
      await call(
        ctx,
        "create_draft_order",
        createArgs([{ productId: cap.id, quantity: 2 }], { address: { ...address, zone: "outside_dhaka" } }),
      ),
    );
    expect(second.data.orderNumber).toBe(first.data.orderNumber);
    expect(second.data.totalText).toBe(formatMoneyMinor(40000 + 12000));
    const orders = await ordersOf(customer.id);
    expect(orders).toHaveLength(1);
    expect(orders[0]!).toMatchObject({ revision: 2, deliveryChargeMinor: 12000 });
    expect(await reservedOf(cap.id)).toBe(capBefore + 2);
  });

  it("after the hold expired, the same arguments create a new draft (not the expired one)", async () => {
    const { phone, customer } = await seedContact();
    const ctx = liveCtx(makeAgent(), phone);
    const args = createArgs([{ productId: cap.id, quantity: 1 }]);
    const first = okOf(await call(ctx, "create_draft_order", args));
    const [old] = await ordersOf(customer.id);
    await db()
      .collection("orders")
      .doc(old!.id)
      .update({ holdExpiresAt: Timestamp.fromMillis(Date.now() - 60_000) });
    const second = okOf(await call(ctx, "create_draft_order", args));
    expect(second.data.orderNumber).not.toBe(first.data.orderNumber);
    expect(await ordersOf(customer.id)).toHaveLength(2);
    // Identical again: the new open draft is returned, no third order.
    const third = okOf(await call(ctx, "create_draft_order", args));
    expect(third.data.orderNumber).toBe(second.data.orderNumber);
    expect(await ordersOf(customer.id)).toHaveLength(2);
  });

  it("stops with a static message once the derived keys run out", async () => {
    const { phone, customer } = await seedContact();
    const ctx = liveCtx(makeAgent(), phone);
    const args = createArgs([{ productId: cap.id, quantity: 1 }]);
    for (let i = 0; i < 5; i += 1) {
      okOf(await call(ctx, "create_draft_order", args));
      const open = (await ordersOf(customer.id)).filter(
        (o) => (o.holdExpiresAt as Timestamp).toMillis() > Date.now(),
      );
      expect(open).toHaveLength(1);
      await db()
        .collection("orders")
        .doc(open[0]!.id)
        .update({ holdExpiresAt: Timestamp.fromMillis(Date.now() - 60_000) });
    }
    expect(await call(ctx, "create_draft_order", args)).toEqual({
      ok: false,
      code: "failed",
      message: "This order can't be created again in this conversation.",
    });
    expect(await ordersOf(customer.id)).toHaveLength(5);
  });

  it("a different session of the same contact starts its own draft", async () => {
    const { phone, customer } = await seedContact();
    const agent = makeAgent();
    const args = createArgs([{ productId: cap.id, quantity: 1 }]);
    okOf(await call(liveCtx(agent, phone), "create_draft_order", args));
    okOf(await call(liveCtx(agent, phone), "create_draft_order", args));
    expect(await ordersOf(customer.id)).toHaveLength(2);
  });

  it("denies a live call without a contact phone, or for a contact with no customer record", async () => {
    const agent = makeAgent();
    const args = createArgs([{ productId: shirt.id, quantity: 1 }]);
    const denied = {
      ok: false,
      code: "denied",
      message: "That customer can't be accessed in this conversation.",
    };
    expect(await call(liveCtx(agent, undefined), "create_draft_order", args)).toEqual(denied);
    expect(await call(liveCtx(agent, newPhone()), "create_draft_order", args)).toEqual(denied);
    for (const name of ["update_draft_order", "confirm_order", "get_my_order_status"]) {
      const input =
        name === "confirm_order"
          ? { customerConfirmed: true, confirmationQuote: "yes" }
          : name === "update_draft_order"
            ? { paymentMethod: "cod" }
            : {};
      expect(await call(liveCtx(agent, undefined), name, input)).toEqual(denied);
    }
  });

  it("refuses an out-of-scope category line before touching the order service", async () => {
    const { phone, customer } = await seedContact();
    const agent = makeAgent({ productAccess: { mode: "categories", categoryIds: [apparelId] } });
    const before = await reservedOf(gadget.id);
    const r = await call(
      liveCtx(agent, phone),
      "create_draft_order",
      createArgs([
        { productId: shirt.id, quantity: 1 },
        { productId: gadget.id, quantity: 1 },
      ]),
    );
    expect(r).toEqual({ ok: false, code: "invalid", message: "One item isn't available." });
    expect(await ordersOf(customer.id)).toHaveLength(0);
    expect(await reservedOf(gadget.id)).toBe(before);
  });

  it("maps a missing product and over-stock lines to static messages that echo nothing", async () => {
    const { phone } = await seedContact();
    const ctx = liveCtx(makeAgent(), phone);
    const missing = await call(
      ctx,
      "create_draft_order",
      createArgs([{ productId: "secret-marker-id", quantity: 1 }]),
    );
    expect(missing).toEqual({ ok: false, code: "invalid", message: "One item isn't available." });
    const over = await call(
      ctx,
      "create_draft_order",
      createArgs([{ productId: gadget.id, quantity: 6 }]),
    );
    expect(over).toEqual({ ok: false, code: "invalid", message: "One item is out of stock." });
  });
});

describe("tight stock: the draft's own hold never blocks it (R16)", () => {
  it("an identical retry and same-line address changes succeed with every unit held", async () => {
    const tight = await seedProduct("Last Three", 30000, apparelId, 3);
    const { phone, customer } = await seedContact();
    const ctx = liveCtx(makeAgent(), phone);
    const args = createArgs([{ productId: tight.id, quantity: 3 }]);
    const first = okOf(await call(ctx, "create_draft_order", args));
    expect(await reservedOf(tight.id)).toBe(3);

    // Identical retry: the same order, nothing reserved again.
    const retry = okOf(await call(ctx, "create_draft_order", args));
    expect(retry.data.orderNumber).toBe(first.data.orderNumber);

    // Same lines, new address through create: an address-only update (no re-reserve).
    const moved = okOf(
      await call(ctx, "create_draft_order", {
        ...args,
        address: { ...address, line1: "House 9, Road 9", zone: "outside_dhaka" },
      }),
    );
    expect(moved.data.orderNumber).toBe(first.data.orderNumber);
    expect(moved.data.deliveryChargeText).toBe(formatMoneyMinor(12000));

    // Same lines again through update_draft_order, with a payment change.
    const paid = okOf(
      await call(ctx, "update_draft_order", {
        lines: [{ productId: tight.id, quantity: 3 }],
        paymentMethod: "online",
      }),
    );
    expect(paid.data).toMatchObject({ orderNumber: first.data.orderNumber, paymentMethod: "online" });

    const orders = await ordersOf(customer.id);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      revision: 1,
      paymentMethod: "online",
      shippingAddress: { line1: "House 9, Road 9", zone: "outside_dhaka" },
    });
    expect(await reservedOf(tight.id)).toBe(3);
  });

  it("credits the draft's own hold in the pre-check, but still refuses more than exists", async () => {
    const tight = await seedProduct("Last Two", 30000, apparelId, 2);
    const { phone } = await seedContact();
    const ctx = liveCtx(makeAgent(), phone);
    okOf(
      await call(ctx, "create_draft_order", createArgs([{ productId: tight.id, quantity: 2 }])),
    );
    expect(
      await call(ctx, "update_draft_order", { lines: [{ productId: tight.id, quantity: 3 }] }),
    ).toEqual({ ok: false, code: "invalid", message: "One item is out of stock." });
    expect(await reservedOf(tight.id)).toBe(2);
  });
});

describe("update_draft_order", () => {
  it("is not_found without an open draft in this session", async () => {
    const { phone } = await seedContact();
    expect(
      await call(liveCtx(makeAgent(), phone), "update_draft_order", { paymentMethod: "online" }),
    ).toEqual({ ok: false, code: "not_found", message: "There is no open order to update." });
  });

  it("changes the session's open draft", async () => {
    const { phone, customer } = await seedContact();
    const ctx = liveCtx(makeAgent(), phone);
    const created = okOf(
      await call(ctx, "create_draft_order", createArgs([{ productId: shirt.id, quantity: 1 }])),
    );
    const r = okOf(
      await call(ctx, "update_draft_order", {
        lines: [{ productId: shirt.id, quantity: 3 }],
        paymentMethod: "online",
      }),
    );
    expect(r.data).toMatchObject({
      orderNumber: created.data.orderNumber,
      paymentMethod: "online",
      totalText: formatMoneyMinor(156000),
    });
    const [order] = await ordersOf(customer.id);
    expect(order).toMatchObject({ revision: 2, paymentMethod: "online" });
    expect(summarizeToolResult("update_draft_order", r)).toBe(
      `Draft ${String(created.data.orderNumber)}: total ${formatMoneyMinor(156000)}`,
    );
  });

  it("previews on the test channel and writes nothing", async () => {
    const ordersBefore = (await docsOf("orders")).length;
    const eventsBefore = (await docsOf("orderEvents")).length;
    const capBefore = await reservedOf(cap.id);
    const r = okOf(
      await call(testCtx(makeAgent()), "update_draft_order", {
        lines: [{ productId: cap.id, quantity: 1 }],
        address,
      }),
    );
    expect(r.data).toMatchObject({ orderNumber: "DRAFT-PREVIEW", totalText: formatMoneyMinor(26000) });
    expect(r.dryRunAction).toMatchObject({ kind: "update_order" });
    expect(await docsOf("orders")).toHaveLength(ordersBefore);
    expect(await docsOf("orderEvents")).toHaveLength(eventsBefore);
    expect(await reservedOf(cap.id)).toBe(capBefore);
  });

  it("asks for the items and address on the test channel, where no draft is stored", async () => {
    expect(
      await call(testCtx(makeAgent()), "update_draft_order", { paymentMethod: "online" }),
    ).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("confirm_order", () => {
  async function draftFor(paymentMethod: "cod" | "online" = "cod") {
    const { phone, customer } = await seedContact();
    const ctx = liveCtx(makeAgent(), phone);
    okOf(
      await call(
        ctx,
        "create_draft_order",
        createArgs([{ productId: cap.id, quantity: 1 }], { paymentMethod }),
      ),
    );
    const [order] = await ordersOf(customer.id);
    return { ctx, customer, order: order! };
  }

  it("refuses without an explicit customer confirmation, never echoing the quote", async () => {
    const { ctx, customer } = await draftFor();
    const r = await call(ctx, "confirm_order", {
      customerConfirmed: false,
      confirmationQuote: "secret-marker",
    });
    expect(r).toEqual({
      ok: false,
      code: "invalid",
      message: "Ask the customer to confirm the summary first.",
    });
    const [order] = await ordersOf(customer.id);
    expect(order!.status).toBe("draft");
  });

  it("confirms the session's open COD draft and records the quote in the timeline", async () => {
    const { ctx, customer, order } = await draftFor();
    const r = okOf(
      await call(ctx, "confirm_order", {
        customerConfirmed: true,
        confirmationQuote: "Ji, confirm\u0007 korun\u0000",
      }),
    );
    expect(r.data).toMatchObject({
      orderNumber: order.orderNumber,
      status: "confirmed",
      paymentStatus: "cod_pending",
      totalText: formatMoneyMinor(26000),
    });
    expect(r.data).not.toHaveProperty("paymentLinkAvailable");
    const [stored] = await ordersOf(customer.id);
    expect(stored!.status).toBe("confirmed");
    const events = (await docsOf("orderEvents"))
      .map((d) => d.data())
      .filter((e) => e.orderId === order.id && e.type === "note");
    expect(events).toHaveLength(1);
    expect(events[0]!.detail).toContain("Ji, confirm korun");
    expect(events[0]!.detail).not.toMatch(/[\u0000-\u001f]/);
    expect(summarizeToolResult("confirm_order", r)).toBe(`Confirmed ${String(order.orderNumber)}`);

    // Confirming again is idempotent: the same order, alreadyConfirmed, no second note event.
    const again = okOf(
      await call(ctx, "confirm_order", { customerConfirmed: true, confirmationQuote: "yes again" }),
    );
    expect(again.data).toMatchObject({
      orderNumber: order.orderNumber,
      status: "confirmed",
      alreadyConfirmed: true,
    });
    expect(await ordersOf(customer.id)).toHaveLength(1);
    const notes = (await docsOf("orderEvents"))
      .map((d) => d.data())
      .filter((e) => e.orderId === order.id && e.type === "note");
    expect(notes).toHaveLength(1);
  });

  it("does not create a second order when the same create is repeated after a confirm (R16)", async () => {
    const { phone, customer } = await seedContact();
    const ctx = liveCtx(makeAgent(), phone);
    const args = createArgs([{ productId: cap.id, quantity: 2 }]);
    okOf(await call(ctx, "create_draft_order", args));
    okOf(await call(ctx, "confirm_order", { customerConfirmed: true, confirmationQuote: "yes" }));
    const reserved = await reservedOf(cap.id);
    expect(await call(ctx, "create_draft_order", args)).toEqual({
      ok: false,
      code: "invalid",
      message: "This order is already confirmed.",
    });
    expect(await ordersOf(customer.id)).toHaveLength(1);
    expect(await reservedOf(cap.id)).toBe(reserved);
  });

  it("confirms an online draft to awaiting_payment and says no payment link exists yet", async () => {
    const { ctx } = await draftFor("online");
    const r = okOf(
      await call(ctx, "confirm_order", { customerConfirmed: true, confirmationQuote: "yes" }),
    );
    expect(r.data).toMatchObject({
      status: "confirmed",
      paymentStatus: "awaiting_payment",
      paymentLinkAvailable: false,
      note: "Online payment links are not available yet; offer cash on delivery or tell the customer the team will send a link.",
    });
  });

  it("refuses an expired draft with the hold message", async () => {
    const { ctx, order } = await draftFor();
    await db()
      .collection("orders")
      .doc(order.id)
      .update({ holdExpiresAt: Timestamp.fromMillis(Date.now() - 60_000) });
    expect(
      await call(ctx, "confirm_order", { customerConfirmed: true, confirmationQuote: "yes" }),
    ).toEqual({
      ok: false,
      code: "invalid",
      message: "The order hold expired; create the order again.",
    });
  });

  it("is not_found when the session has no draft", async () => {
    const { phone } = await seedContact();
    expect(
      await call(liveCtx(makeAgent(), phone), "confirm_order", {
        customerConfirmed: true,
        confirmationQuote: "yes",
      }),
    ).toEqual({ ok: false, code: "not_found", message: "There is no open order to confirm." });
  });

  it("returns a confirm_order dry run on the test channel without any lookup", async () => {
    const r = okOf(
      await call(testCtx(makeAgent()), "confirm_order", {
        customerConfirmed: true,
        confirmationQuote: "yes please",
      }),
    );
    expect(r.dryRunAction).toEqual({ kind: "confirm_order", fields: { quoteLength: 10 } });
    expect(JSON.stringify(r)).not.toContain("yes please");
    expect(r.data).toMatchObject({ orderNumber: "DRAFT-PREVIEW", status: "confirmed" });
  });
});

describe("get_my_order_status", () => {
  it("lists only the contact's own orders", async () => {
    const { phone, customer } = await seedContact();
    const other = await seedContact();
    const ctx = liveCtx(makeAgent(), phone);
    const mine = okOf(
      await call(ctx, "create_draft_order", createArgs([{ productId: cap.id, quantity: 1 }])),
    );
    const foreign = await createDraftOrder(seedCtx, {
      customerId: other.customer.id,
      lines: [{ productId: cap.id, quantity: 1 }],
      shippingAddress: shippingAddressSchema.parse({ ...address, phone: other.phone }),
      paymentMethod: "cod",
      discountMinor: 0,
      idempotencyKey: `key-${randomUUID()}`,
      source: "staff",
    });
    const r = okOf(await call(ctx, "get_my_order_status", {}));
    const orders = r.data.orders as Array<Record<string, unknown>>;
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      orderNumber: mine.data.orderNumber,
      status: "draft",
      paymentStatus: "cod_pending",
      totalText: formatMoneyMinor(26000),
    });
    expect(typeof orders[0]!.createdAt).toBe("string");
    expect(JSON.stringify(r)).not.toContain(foreign.orderNumber);
    expect(JSON.stringify(r)).not.toContain(customer.id);
    expect(summarizeToolResult("get_my_order_status", r)).toBe("1 orders");
  });

  it("returns no orders on the test channel", async () => {
    expect(okOf(await call(testCtx(makeAgent()), "get_my_order_status", {})).data).toEqual({
      orders: [],
    });
  });

  it("includes courier tracking details when shipment is booked", async () => {
    const { phone, customer } = await seedContact();
    const ctx = liveCtx(makeAgent(), phone);
    const order = await createDraftOrder(seedCtx, {
      customerId: customer.id,
      lines: [{ productId: cap.id, quantity: 1 }],
      shippingAddress: shippingAddressSchema.parse({ ...address, phone }),
      paymentMethod: "cod",
      discountMinor: 0,
      idempotencyKey: `key-${randomUUID()}`,
      source: "staff",
    });

    const ref = db().collection("orders").doc(order.id);
    await ref.update({
      status: "shipped",
      shipment: {
        courierAccountId: "acc_mock",
        provider: "mock",
        bookingState: "booked",
        consignmentId: "mock_cid_123",
        trackingCode: "MOCK_TRACK_123",
        trackingUrl: "https://track.mockcourier.local/MOCK_TRACK_123",
        status: "in_transit",
        codAmountMinor: 26000,
        weightKg: 0.5,
      },
    });

    const r = okOf(await call(ctx, "get_my_order_status", {}));
    const orders = r.data.orders as Array<Record<string, unknown>>;
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      orderNumber: order.orderNumber,
      status: "shipped",
      courierName: "MOCK",
      trackingCode: "MOCK_TRACK_123",
      trackingUrl: "https://track.mockcourier.local/MOCK_TRACK_123",
      courierStatus: "in_transit",
    });
  });
});

describe("calculate_order_total with a delivery zone", () => {
  it("adds the outside-Dhaka delivery charge and the total", async () => {
    const r = okOf(
      await call(testCtx(makeAgent()), "calculate_order_total", {
        items: [{ productId: shirt.id, quantity: 1 }],
        customerType: "retail",
        zone: "outside_dhaka",
      }),
    );
    expect(r.data).toMatchObject({
      subtotalText: formatMoneyMinor(50000),
      deliveryChargeText: formatMoneyMinor(12000),
      totalText: formatMoneyMinor(62000),
    });
    expect(r.data).not.toHaveProperty("deliveryNote");
  });

  it("keeps a delivery note without a zone", async () => {
    const r = okOf(
      await call(testCtx(makeAgent()), "calculate_order_total", {
        items: [{ productId: shirt.id, quantity: 1 }],
        customerType: "retail",
      }),
    );
    expect(r.data.deliveryNote).toBe(
      "Delivery charge depends on the address; ask whether it is inside or outside Dhaka.",
    );
    expect(r.data).not.toHaveProperty("totalText");
  });
});
