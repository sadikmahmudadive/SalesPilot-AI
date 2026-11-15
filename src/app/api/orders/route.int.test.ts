import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/security/permissions";
import { customerInputSchema } from "@/schemas/customer";
import { productInputSchema } from "@/schemas/product";
import { createCustomer } from "@/services/crm/customers";
import { adjustStock } from "@/services/inventory/stock";
import { createProduct } from "@/services/products/products";
import { withPinnedRateWindow } from "@/test/pin-clock";

import { GET as GET_SETTINGS, PATCH as PATCH_SETTINGS } from "../settings/orders/route";
import { GET as GET_ONE, PATCH } from "./[id]/route";
import { POST as ACTION } from "./[id]/[action]/route";
import { GET as GET_EVENTS } from "./[id]/events/route";
import { GET, POST } from "./route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

const BASE = "http://localhost/api/orders";
const orgs = new Set<string>();
const uids: string[] = [];
let counter = 0;
const phone = () => `01714${String(1000000 + ++counter).slice(1)}`;

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

/** A customer and a product with stock, created through the services for `organizationId`. */
async function seedCatalog(organizationId: string, uid: string, stock = 20) {
  const ctx = { organizationId, uid };
  const customer = await createCustomer(
    ctx,
    customerInputSchema.parse({ fullName: "Md. Rahim", phone: phone() }),
  );
  const product = await createProduct(
    ctx,
    productInputSchema.parse({
      name: `Shirt ${randomUUID().slice(0, 6)}`,
      sku: `sku-${randomUUID().slice(0, 8)}`,
      regularPriceMinor: 50000,
      availability: "active",
      variants: [],
    }),
  );
  await adjustStock(ctx, product.id, "default", { delta: stock, reason: "seed" });
  return { customerId: customer.id, productId: product.id };
}

function send(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  const raw =
    body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  const h = new Headers(body === undefined ? {} : { "content-type": "application/json" });
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  if (raw !== undefined) h.set("content-length", String(Buffer.byteLength(raw)));
  return new Request(url, { method, headers: h, body: raw });
}
const post = (body: unknown, headers?: Record<string, string>) =>
  POST(send("POST", BASE, body, headers));
const list = (qs = "") => GET(send("GET", `${BASE}${qs ? `?${qs}` : ""}`));
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const getOne = (id: string) => GET_ONE(send("GET", `${BASE}/${id}`), idCtx(id));
const patchOne = (id: string, body: unknown, headers?: Record<string, string>) =>
  PATCH(send("PATCH", `${BASE}/${id}`, body, headers), idCtx(id));
const events = (id: string) => GET_EVENTS(send("GET", `${BASE}/${id}/events`), idCtx(id));
const act = (id: string, action: string, body?: unknown, headers?: Record<string, string>) =>
  ACTION(send("POST", `${BASE}/${id}/${action}`, body, headers), {
    params: Promise.resolve({ id, action }),
  });
const getSettings = () => GET_SETTINGS(send("GET", "http://localhost/api/settings/orders"));
const patchSettings = (body: unknown, headers?: Record<string, string>) =>
  PATCH_SETTINGS(send("PATCH", "http://localhost/api/settings/orders", body, headers));

const address = () => ({
  recipientName: "Rahim",
  phone: "01712345678",
  line1: "House 1, Road 2",
  zone: "inside_dhaka",
});
const valid = (
  cat: { customerId: string; productId: string },
  over: Record<string, unknown> = {},
) => ({
  customerId: cat.customerId,
  lines: [{ productId: cat.productId, quantity: 1 }],
  shippingAddress: address(),
  paymentMethod: "cod",
  idempotencyKey: `key-${randomUUID()}`,
  ...over,
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as Json;

beforeEach(() => {
  session = null;
});

afterAll(async () => {
  const db = adminDb();
  for (const org of orgs) {
    for (const col of ["inventory"]) {
      const snap = await db.collection(col).where("organizationId", "==", org).get();
      for (const d of snap.docs) await db.recursiveDelete(d.ref);
    }
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
      "customers",
      "customerPhones",
    ]) {
      const snap = await db.collection(col).where("organizationId", "==", org).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  }
  await Promise.all(
    uids.flatMap((u) => [
      db.collection("users").doc(u).delete(),
      ...[...orgs].map((o) => db.collection("organizationMembers").doc(`${o}_${u}`).delete()),
    ]),
  );
});

describe("authentication and permissions", () => {
  it("401 without a session on every route", async () => {
    expect((await list()).status).toBe(401);
    expect((await post({})).status).toBe(401);
    expect((await getOne("x")).status).toBe(401);
    expect((await patchOne("x", { notes: "a" })).status).toBe(401);
    expect((await act("x", "confirm")).status).toBe(401);
    expect((await act("x", "explode")).status).toBe(401);
    expect((await events("x")).status).toBe(401);
    expect((await getSettings()).status).toBe(401);
    expect((await patchSettings({ draftHoldMinutes: 10 })).status).toBe(401);
  });

  it("403 for a user without membership", async () => {
    signIn(`uid-${randomUUID()}`);
    expect((await list()).status).toBe(403);
  });

  it("viewer can read but not create, patch or act", async () => {
    const owner = await seed("owner");
    const cat = await seedCatalog(owner.organizationId, owner.uid);
    signIn(owner.uid);
    const created = await json(await post(valid(cat)));
    const viewer = await seed("viewer", owner.organizationId);
    signIn(viewer.uid);
    expect((await list()).status).toBe(200);
    expect((await getOne(created.id)).status).toBe(200);
    expect((await events(created.id)).status).toBe(200);
    expect((await getSettings()).status).toBe(200);
    expect((await post(valid(cat))).status).toBe(403);
    expect((await patchOne(created.id, { notes: "x" })).status).toBe(403);
    expect((await act(created.id, "confirm")).status).toBe(403);
    expect((await act(created.id, "explode")).status).toBe(403);
  });

  it("agent can create an order (staff source, createdBy the user)", async () => {
    const agent = await seed("agent");
    const cat = await seedCatalog(agent.organizationId, agent.uid);
    signIn(agent.uid);
    const res = await post(valid(cat));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const order = await json(res);
    expect(order).toMatchObject({
      organizationId: agent.organizationId,
      status: "draft",
      source: "staff",
      createdBy: { kind: "user", uid: agent.uid },
      orderNumber: "SP-000001",
    });
  });
});

describe("POST /api/orders", () => {
  it("400 invalid body, 415 text/plain, 403 cross-origin", async () => {
    const owner = await seed("owner");
    const cat = await seedCatalog(owner.organizationId, owner.uid);
    signIn(owner.uid);
    expect((await post("not json")).status).toBe(400);
    expect((await post({ customerId: cat.customerId })).status).toBe(400);
    expect((await post(valid(cat, { lines: [] }))).status).toBe(400);
    expect((await post(JSON.stringify(valid(cat)), { "content-type": "text/plain" })).status).toBe(
      415,
    );
    expect((await post(valid(cat), { origin: "https://evil.com" })).status).toBe(403);
    expect((await post(valid(cat), { "sec-fetch-site": "cross-site" })).status).toBe(403);
  });

  it("confirm: true creates then confirms; a replay with the same key returns the same order", async () => {
    const owner = await seed("owner");
    const cat = await seedCatalog(owner.organizationId, owner.uid);
    signIn(owner.uid);
    const body = valid(cat, { confirm: true });
    const first = await post(body);
    expect(first.status).toBe(201);
    const order = await json(first);
    expect(order.status).toBe("confirmed");

    const replay = await post(body);
    expect([200, 201]).toContain(replay.status);
    const again = await json(replay);
    expect(again.id).toBe(order.id);
    expect(again.status).toBe("confirmed");
  });

  it("without confirm the order stays a draft and a replay returns it", async () => {
    const owner = await seed("owner");
    const cat = await seedCatalog(owner.organizationId, owner.uid);
    signIn(owner.uid);
    const body = valid(cat);
    const a = await json(await post(body));
    const b = await json(await post(body));
    expect(a.status).toBe("draft");
    expect(b.id).toBe(a.id);
  });

  it("is scoped to the organization: another org's customer is a 404", async () => {
    const a = await seed("owner");
    const b = await seed("owner");
    const catA = await seedCatalog(a.organizationId, a.uid);
    const catB = await seedCatalog(b.organizationId, b.uid);
    signIn(a.uid);
    expect(
      (await post(valid({ customerId: catB.customerId, productId: catA.productId }))).status,
    ).toBe(404);
  });
});

describe("GET/PATCH /api/orders/[id] and events", () => {
  it("get returns the order with `expired`; patch edits a draft; events lists the timeline", async () => {
    const owner = await seed("owner");
    const cat = await seedCatalog(owner.organizationId, owner.uid);
    signIn(owner.uid);
    const created = await json(await post(valid(cat)));

    const got = await json(await getOne(created.id));
    expect(got).toMatchObject({ id: created.id, expired: false });

    const res = await patchOne(created.id, {
      notes: "Call before delivery",
      lines: [{ productId: cat.productId, quantity: 3 }],
    });
    expect(res.status).toBe(200);
    const patched = await json(res);
    expect(patched.notes).toBe("Call before delivery");
    expect(patched.lines[0].quantity).toBe(3);
    expect(patched.subtotalMinor).toBe(150000);

    const ev = await events(created.id);
    expect(ev.status).toBe(200);
    const body = await json(ev);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(2);
    expect(body.items[0].type).toBe("created");
    expect(Object.keys(body)).toEqual(["items"]);
  });

  it("PATCH validation: 400 on an empty patch, 415, 403 cross-origin", async () => {
    const owner = await seed("owner");
    const cat = await seedCatalog(owner.organizationId, owner.uid);
    signIn(owner.uid);
    const created = await json(await post(valid(cat)));
    expect((await patchOne(created.id, {})).status).toBe(400);
    expect((await patchOne(created.id, { discountMinor: -1 })).status).toBe(400);
    expect(
      (
        await patchOne(created.id, JSON.stringify({ notes: "x" }), {
          "content-type": "text/plain",
        })
      ).status,
    ).toBe(415);
    expect(
      (await patchOne(created.id, { notes: "x" }, { origin: "https://evil.com" })).status,
    ).toBe(403);
  });

  it("404 for another organization's id and for invalid ids (get, patch, events, actions)", async () => {
    const a = await seed("owner");
    const b = await seed("owner");
    const cat = await seedCatalog(a.organizationId, a.uid);
    signIn(a.uid);
    const created = await json(await post(valid(cat)));
    signIn(b.uid);
    expect((await getOne(created.id)).status).toBe(404);
    expect((await patchOne(created.id, { notes: "hacked" })).status).toBe(404);
    expect((await events(created.id)).status).toBe(404);
    expect((await act(created.id, "confirm")).status).toBe(404);
    expect((await act(created.id, "cancel", { reason: "nope" })).status).toBe(404);
    for (const id of ["a/b", "..", "__x__", "x".repeat(2000)]) {
      expect((await getOne(id)).status, id.slice(0, 10)).toBe(404);
      expect((await act(id, "confirm")).status).toBe(404);
    }
    signIn(a.uid);
    expect((await json(await getOne(created.id))).status).toBe("draft");
  });
});

describe("POST /api/orders/[id]/[action]", () => {
  it("walks confirm -> process -> ship -> deliver -> return", async () => {
    const owner = await seed("owner");
    const cat = await seedCatalog(owner.organizationId, owner.uid);
    signIn(owner.uid);
    const created = await json(await post(valid(cat)));

    const expectStatus = async (action: string, status: string, body?: unknown) => {
      const res = await act(created.id, action, body);
      expect(res.status, action).toBe(200);
      expect((await json(res)).status).toBe(status);
    };
    await expectStatus("confirm", "confirmed");
    await expectStatus("process", "processing", {});
    await expectStatus("ship", "shipped");
    await expectStatus("deliver", "delivered");
    await expectStatus("return", "returned");
  });

  it("process accepts an empty JSON object and needs a JSON body", async () => {
    const owner = await seed("owner");
    const cat = await seedCatalog(owner.organizationId, owner.uid);
    signIn(owner.uid);
    const created = await json(await post(valid(cat, { confirm: true })));
    expect((await act(created.id, "process")).status).toBe(400);
    const res = await act(created.id, "process", {});
    expect(res.status).toBe(200);
    expect((await json(res)).status).toBe("processing");
  });

  it("cancel records the reason; refund of an unpaid COD order is a 409", async () => {
    const owner = await seed("owner");
    const cat = await seedCatalog(owner.organizationId, owner.uid);
    signIn(owner.uid);
    const created = await json(await post(valid(cat, { confirm: true })));
    expect((await act(created.id, "refund", { reason: "Customer asked" })).status).toBe(409);
    const res = await act(created.id, "cancel", { reason: "Out of stock" });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: "cancelled", cancelReason: "Out of stock" });
  });

  it("an invalid transition is a 409", async () => {
    const owner = await seed("owner");
    const cat = await seedCatalog(owner.organizationId, owner.uid);
    signIn(owner.uid);
    const created = await json(await post(valid(cat)));
    expect((await act(created.id, "ship")).status).toBe(409);
  });

  it("400 for an empty or missing reason and a bad process body", async () => {
    const owner = await seed("owner");
    const cat = await seedCatalog(owner.organizationId, owner.uid);
    signIn(owner.uid);
    const created = await json(await post(valid(cat)));
    expect((await act(created.id, "cancel", { reason: "" })).status).toBe(400);
    expect((await act(created.id, "cancel", { reason: "   " })).status).toBe(400);
    expect((await act(created.id, "cancel", {})).status).toBe(400);
    expect((await act(created.id, "cancel")).status).toBe(400);
    expect((await act(created.id, "refund", { reason: "" })).status).toBe(400);
    expect((await act(created.id, "process", { allowUnpaidReason: "" })).status).toBe(400);
    expect((await json(await getOne(created.id))).status).toBe("draft");
  });

  it("unknown actions are a 404, including inherited object keys", async () => {
    const owner = await seed("owner");
    const cat = await seedCatalog(owner.organizationId, owner.uid);
    signIn(owner.uid);
    const created = await json(await post(valid(cat)));
    for (const action of ["explode", "expire", "constructor", "__proto__", "toString", ""]) {
      expect((await act(created.id, action)).status, action).toBe(404);
    }
  });

  it("keeps the same-origin check on body-less actions and requires JSON for body actions", async () => {
    const owner = await seed("owner");
    const cat = await seedCatalog(owner.organizationId, owner.uid);
    signIn(owner.uid);
    const created = await json(await post(valid(cat)));
    const evil = { origin: "https://evil.com" };
    expect((await act(created.id, "confirm", undefined, evil)).status).toBe(403);
    expect((await act(created.id, "ship", undefined, evil)).status).toBe(403);
    expect((await act(created.id, "cancel", { reason: "x" }, evil)).status).toBe(403);
    expect(
      (await act(created.id, "confirm", undefined, { "sec-fetch-site": "cross-site" })).status,
    ).toBe(403);
    expect(
      (
        await act(created.id, "cancel", JSON.stringify({ reason: "x" }), {
          "content-type": "text/plain",
        })
      ).status,
    ).toBe(415);
    expect((await json(await getOne(created.id))).status).toBe("draft");
  });
});

describe("GET /api/orders", () => {
  it("lists with pagination and filters, scoped to the organization", async () => {
    const owner = await seed("owner");
    const other = await seed("owner");
    const cat = await seedCatalog(owner.organizationId, owner.uid);
    const otherCat = await seedCatalog(other.organizationId, other.uid);
    signIn(other.uid);
    await post(valid(otherCat));
    signIn(owner.uid);
    const first = await json(await post(valid(cat, { confirm: true })));
    await post(valid(cat));
    await post(valid(cat));

    const page1 = await json(await list("limit=2"));
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await json(await list(`limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`));
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    const confirmed = await json(await list("status=confirmed"));
    expect(confirmed.items.map((o: Json) => o.id)).toEqual([first.id]);
    expect((await json(await list("status=draft"))).items).toHaveLength(2);
    expect((await json(await list(`customerId=${cat.customerId}`))).items).toHaveLength(3);
    expect((await json(await list(`q=${first.orderNumber}`))).items.map((o: Json) => o.id)).toEqual(
      [first.id],
    );
    expect(
      (await json(await list("q=SP-000001"))).items.every(
        (o: Json) => o.organizationId === owner.organizationId,
      ),
    ).toBe(true);

    const from = encodeURIComponent("2000-01-01T00:00:00Z");
    const to = encodeURIComponent("2000-01-02T00:00:00+06:00");
    expect((await json(await list(`from=${from}`))).items).toHaveLength(3);
    expect((await json(await list(`from=${from}&to=${to}`))).items).toHaveLength(0);
  });

  it("400 for invalid filters, dates, limits, repeated params and unsupported combinations; unknown params ignored", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    expect((await list("status=nope")).status).toBe(400);
    expect((await list("paymentStatus=nope")).status).toBe(400);
    expect((await list("from=yesterday")).status).toBe(400);
    expect((await list("from=2026-01-01")).status).toBe(400);
    expect((await list("to=2026-01-01T00:00:00")).status).toBe(400);
    expect((await list("limit=0")).status).toBe(400);
    expect((await list("limit=101")).status).toBe(400);
    expect((await list("limit=abc")).status).toBe(400);
    expect((await list("status=draft&status=confirmed")).status).toBe(400);
    expect((await list("status=draft&paymentStatus=cod_pending")).status).toBe(400);
    const res = await list("status=nope");
    const body = await json(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(body)).not.toContain("nope");
    expect((await list("limit=100&whatever=1")).status).toBe(200);
    expect((await list("status=&q=")).status).toBe(200);
  });
});

describe("/api/settings/orders", () => {
  it("GET returns defaults; PATCH by an agent is 403, by an owner merges and persists", async () => {
    const owner = await seed("owner");
    const agent = await seed("agent", owner.organizationId);
    signIn(agent.uid);
    expect((await patchSettings({ draftHoldMinutes: 10 })).status).toBe(403);
    expect(await json(await getSettings())).toEqual({
      deliveryChargeInsideDhakaMinor: 6000,
      deliveryChargeOutsideDhakaMinor: 12000,
      draftHoldMinutes: 30,
      paymentHoldHours: 24,
    });

    signIn(owner.uid);
    const res = await patchSettings({ draftHoldMinutes: 10, deliveryChargeInsideDhakaMinor: 5000 });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      deliveryChargeInsideDhakaMinor: 5000,
      deliveryChargeOutsideDhakaMinor: 12000,
      draftHoldMinutes: 10,
      paymentHoldHours: 24,
    });
    signIn(agent.uid);
    expect((await json(await getSettings())).draftHoldMinutes).toBe(10);
  });

  it("PATCH 400 for an empty patch, unknown-only keys or bad values; 415; 403 cross-origin", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    expect((await patchSettings({})).status).toBe(400);
    expect((await patchSettings({ organizationId: "evil" })).status).toBe(400);
    expect((await patchSettings({ draftHoldMinutes: 4 })).status).toBe(400);
    expect((await patchSettings({ paymentHoldHours: 1.5 })).status).toBe(400);
    expect((await patchSettings("not json")).status).toBe(400);
    expect(
      (
        await patchSettings(JSON.stringify({ draftHoldMinutes: 10 }), {
          "content-type": "text/plain",
        })
      ).status,
    ).toBe(415);
    expect(
      (await patchSettings({ draftHoldMinutes: 10 }, { origin: "https://evil.com" })).status,
    ).toBe(403);
  });

  it("PATCH is rate limited to 20 per minute per user (21st -> 429)", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const statuses: number[] = [];
    await withPinnedRateWindow(async () => {
      for (let i = 0; i < 21; i++)
        statuses.push((await patchSettings({ draftHoldMinutes: 10 + i })).status);
    });
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  }, 120_000);
});
