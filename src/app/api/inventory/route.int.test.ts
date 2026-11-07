import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/security/permissions";
import { productInputSchema } from "@/schemas/product";
import { listInventory } from "@/services/inventory/inventory-list";
import { reserveStock } from "@/services/inventory/stock";
import { createProduct } from "@/services/products/products";
import { withPinnedRateWindow } from "@/test/pin-clock";

import { POST as ADJUST } from "./adjust/route";
import { GET } from "./route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

const BASE = "http://localhost/api/inventory";
const orgs = new Set<string>();
const uids: string[] = [];
let counter = 0;

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
): Request {
  const raw =
    body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  const h = new Headers(body === undefined ? {} : { "content-type": "application/json" });
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  if (raw !== undefined) h.set("content-length", String(Buffer.byteLength(raw)));
  return new Request(url, { method, headers: h, body: raw });
}
const list = (qs = "") => GET(send("GET", `${BASE}${qs ? `?${qs}` : ""}`));
const adjust = (body: unknown, headers?: Record<string, string>) =>
  ADJUST(send("POST", `${BASE}/adjust`, body, headers));

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as Json;

type Actor = Awaited<ReturnType<typeof seed>>;
async function makeProduct(actor: Actor, over: Record<string, unknown> = {}) {
  counter += 1;
  return createProduct(
    actor,
    productInputSchema.parse({
      name: `Inv Product ${counter}`,
      sku: `inv-${counter}-${randomUUID().slice(0, 6)}`,
      regularPriceMinor: 1000,
      ...over,
    }),
  );
}
const setStock = (productId: string, variantId: string, onHand: number, reserved = 0) =>
  adminDb()
    .collection("inventory")
    .doc(`${productId}__${variantId}`)
    .update({ onHand, reserved, available: onHand - reserved, updatedAt: new Date() });
const invOf = async (productId: string, variantId = "default") =>
  (await adminDb().collection("inventory").doc(`${productId}__${variantId}`).get()).data()!;

beforeEach(() => {
  session = null;
});

afterAll(async () => {
  const db = adminDb();
  for (const org of orgs) {
    for (const col of ["products", "productSkus", "productSlugs", "inventory", "auditLogs"]) {
      const snap = await db.collection(col).where("organizationId", "==", org).get();
      await Promise.all(snap.docs.map((d) => db.recursiveDelete(d.ref)));
    }
  }
  await Promise.all(
    uids.flatMap((u) => [
      db.collection("users").doc(u).delete(),
      ...[...orgs].map((o) => db.collection("organizationMembers").doc(`${o}_${u}`).delete()),
    ]),
  );
});

describe("authentication, permissions and CSRF", () => {
  const body = { productId: "p", variantId: "default", delta: 1, reason: "Stock count" };

  it("401 without a session", async () => {
    expect((await list()).status).toBe(401);
    expect((await adjust(body)).status).toBe(401);
  });

  it("403 for a user without membership", async () => {
    signIn(`uid-${randomUUID()}`);
    expect((await list()).status).toBe(403);
    expect((await adjust(body)).status).toBe(403);
  });

  it.each(["viewer", "agent"] as const)("%s can read but not adjust", async (role) => {
    const actor = await seed(role);
    signIn(actor.uid);
    expect((await list()).status).toBe(200);
    const owner = await seed("owner", actor.organizationId);
    const p = await makeProduct(owner);
    await setStock(p.id, "default", 5);
    const res = await adjust({
      productId: p.id,
      variantId: "default",
      delta: 1,
      reason: "Stock count",
    });
    expect(res.status).toBe(403);
    expect((await invOf(p.id)).onHand).toBe(5);
  });

  it.each(["owner", "admin"] as const)("%s can adjust", async (role) => {
    const actor = await seed(role);
    signIn(actor.uid);
    const p = await makeProduct(actor);
    const res = await adjust({
      productId: p.id,
      variantId: "default",
      delta: 7,
      reason: "Stock count",
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ onHand: 7, available: 7 });
  });

  it("403 for a cross-origin adjust, nothing changes", async () => {
    const actor = await seed("owner");
    signIn(actor.uid);
    const p = await makeProduct(actor);
    const res = await adjust(
      { productId: p.id, variantId: "default", delta: 3, reason: "Stock count" },
      { origin: "https://evil.example" },
    );
    expect(res.status).toBe(403);
    expect((await invOf(p.id)).onHand).toBe(0);
  });
});

describe("POST /api/inventory/adjust", () => {
  async function owner() {
    const actor = await seed("owner");
    signIn(actor.uid);
    const p = await makeProduct(actor);
    return { actor, p };
  }
  const req = (p: { id: string }, over: Record<string, unknown> = {}) => ({
    productId: p.id,
    variantId: "default",
    delta: 4,
    reason: "Received shipment",
    ...over,
  });

  it("returns the updated record and writes an audit row", async () => {
    const { actor, p } = await owner();
    const res = await adjust(req(p));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await json(res)).toMatchObject({
      id: `${p.id}__default`,
      organizationId: actor.organizationId,
      productId: p.id,
      variantId: "default",
      onHand: 4,
      reserved: 0,
      available: 4,
    });
    const logs = await adminDb()
      .collection("auditLogs")
      .where("organizationId", "==", actor.organizationId)
      .where("action", "==", "inventory.adjust")
      .get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0]!.data()).toMatchObject({
      actorUid: actor.uid,
      before: { onHand: 0, reserved: 0, available: 0 },
      after: { onHand: 4, delta: 4, reason: "Received shipment" },
    });
  });

  it.each([
    ["missing reason", { reason: undefined }],
    ["blank reason", { reason: "   " }],
    ["short reason", { reason: "ab" }],
    ["long reason", { reason: "x".repeat(201) }],
    ["delta 0", { delta: 0 }],
    ["fractional delta", { delta: 1.5 }],
    ["huge delta", { delta: 1_000_001 }],
    ["string delta", { delta: "5" }],
    ["missing delta", { delta: undefined }],
  ])("400 for %s, nothing changes", async (_n, over) => {
    const { p } = await owner();
    const res = await adjust(req(p, over));
    expect(res.status).toBe(400);
    expect((await invOf(p.id)).onHand).toBe(0);
  });

  it("400 for a malformed body and 415 for a wrong content type", async () => {
    await owner();
    expect((await adjust("{nope")).status).toBe(400);
    const res = await ADJUST(
      new Request(`${BASE}/adjust`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "x",
      }),
    );
    expect(res.status).toBe(415);
  });

  it("409 when the result would drop onHand below the reserved quantity", async () => {
    const { actor, p } = await owner();
    await setStock(p.id, "default", 5);
    await reserveStock(actor.organizationId, p.id, "default", 4, "order-1");
    const res = await adjust(req(p, { delta: -2 }));
    expect(res.status).toBe(409);
    expect(await invOf(p.id)).toMatchObject({ onHand: 5, reserved: 4, available: 1 });
    expect((await adjust(req(p, { delta: -1 }))).status).toBe(200);
  });

  it("400 when the result exceeds the maximum stock", async () => {
    const { p } = await owner();
    await setStock(p.id, "default", 999_999_999);
    expect((await adjust(req(p, { delta: 2 }))).status).toBe(400);
  });

  it("404 for unknown, malformed and other-organization products or variants", async () => {
    const { p } = await owner();
    const other = await seed("owner");
    const foreign = await makeProduct(other);
    await setStock(foreign.id, "default", 9);

    for (const over of [
      { productId: "ghost" },
      { productId: "a/b" },
      { productId: ".." },
      { variantId: "nope" },
      { variantId: "Bad Id" },
      { productId: foreign.id },
    ]) {
      const res = await adjust(req(p, over));
      expect(res.status, JSON.stringify(over)).toBe(404);
    }
    expect((await invOf(foreign.id)).onHand).toBe(9);
    expect(
      (
        await adminDb()
          .collection("auditLogs")
          .where("organizationId", "==", other.organizationId)
          .get()
      ).docs.filter((d) => d.get("action") === "inventory.adjust"),
    ).toHaveLength(0);
  });

  it("is rate limited to 60 adjustments per minute per user (61st -> 429, nothing applied)", async () => {
    const { p } = await owner();
    const statuses: number[] = [];
    let last: Response | undefined;
    await withPinnedRateWindow(async () => {
      for (let i = 0; i < 61; i++) {
        last = await adjust(req(p, { delta: 1 }));
        statuses.push(last.status);
      }
    });
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
    expect(last!.headers.get("retry-after")).toBeTruthy();
    expect((await invOf(p.id)).onHand).toBe(60);
  }, 120_000);

  it("adjusts a variant's own unit", async () => {
    const actor = await seed("owner");
    signIn(actor.uid);
    const p = await makeProduct(actor, {
      variants: [{ size: "M", color: "Red" }, { size: "L" }],
    });
    const [v1, v2] = p.variants;
    const res = await adjust({
      productId: p.id,
      variantId: v1!.id,
      delta: 6,
      reason: "Stock count",
    });
    expect(res.status).toBe(200);
    expect((await invOf(p.id, v1!.id)).onHand).toBe(6);
    expect((await invOf(p.id, v2!.id)).onHand).toBe(0);
    // the default unit does not exist for a product with variants
    expect(
      (await adjust({ productId: p.id, variantId: "default", delta: 1, reason: "Stock count" }))
        .status,
    ).toBe(404);
  });

  it("ignores client-supplied organizationId and counters", async () => {
    const { actor, p } = await owner();
    const res = await adjust(req(p, { organizationId: "evil", onHand: 9999, available: 9999 }));
    expect(res.status).toBe(200);
    expect(await invOf(p.id)).toMatchObject({
      organizationId: actor.organizationId,
      onHand: 4,
      available: 4,
    });
  });
});

describe("GET /api/inventory", () => {
  it("only lists the caller's organization", async () => {
    const a = await seed("viewer");
    const b = await seed("owner");
    const pa = await makeProduct(a);
    const pb = await makeProduct(b);
    signIn(a.uid);
    const body = await json(await list());
    const ids = (body.items as Json[]).map((i) => i.productId);
    expect(ids).toContain(pa.id);
    expect(ids).not.toContain(pb.id);
    expect((body.items as Json[]).every((i) => i.organizationId === a.organizationId)).toBe(true);
    // asking for another org's product yields nothing, not an error or a leak
    const res = await list(`productId=${pb.id}`);
    expect(res.status).toBe(200);
    expect((await json(res)).items).toEqual([]);
  });

  it("enriches rows with product name, sku and variant label", async () => {
    const actor = await seed("owner");
    signIn(actor.uid);
    const plain = await makeProduct(actor, {
      name: "Plain Tee",
      sku: `plain-${randomUUID().slice(0, 6)}`,
    });
    const varied = await makeProduct(actor, {
      name: "Varied Tee",
      variants: [{ size: "M", color: "Red" }, { size: "L" }, { color: "Blue" }],
    });
    const body = await json(await list("limit=50"));
    const items = body.items as Json[];
    const defaultRow = items.find((i) => i.productId === plain.id)!;
    expect(defaultRow).toMatchObject({
      productName: "Plain Tee",
      sku: plain.sku,
      variantLabel: "Default",
    });
    const labels = items
      .filter((i) => i.productId === varied.id)
      .map((i) => i.variantLabel)
      .sort();
    expect(labels).toEqual(["Blue", "L", "M / Red"]);
    expect(
      items.filter((i) => i.productId === varied.id).every((i) => i.productName === "Varied Tee"),
    ).toBe(true);
  });

  it("uses a placeholder for a missing product or one from another organization, leaking nothing", async () => {
    const a = await seed("owner");
    const b = await seed("owner");
    signIn(a.uid);
    const foreign = await makeProduct(b, { name: "Top Secret Product" });
    const db = adminDb();
    // inventory docs of org A that point at a missing product and at org B's product
    const orphan = {
      organizationId: a.organizationId,
      variantId: "default",
      onHand: 3,
      reserved: 0,
      available: 3,
    };
    await db
      .collection("inventory")
      .doc("ghost-product__default")
      .set({ ...orphan, productId: "ghost-product", createdAt: new Date(), updatedAt: new Date() });
    await db
      .collection("inventory")
      .doc(`${foreign.id}__a-default`)
      .set({
        ...orphan,
        productId: foreign.id,
        variantId: "default",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

    const res = await list("limit=50");
    const text = await res.text();
    expect(text).not.toContain("Top Secret Product");
    expect(text).not.toContain(foreign.sku);
    const items = (JSON.parse(text) as Json).items as Json[];
    const ghost = items.find((i) => i.productId === "ghost-product")!;
    expect(ghost).toMatchObject({
      productName: "Unknown product",
      sku: null,
      variantLabel: "Default",
    });
    const crossRow = items.find((i) => i.id === `${foreign.id}__a-default`)!;
    expect(crossRow).toMatchObject({ productName: "Unknown product", sku: null });

    await db.collection("inventory").doc("ghost-product__default").delete();
    await db.collection("inventory").doc(`${foreign.id}__a-default`).delete();
  });

  it("lowStock includes available 5 and excludes 6, ordered lowest first", async () => {
    const actor = await seed("owner");
    signIn(actor.uid);
    const ps = await Promise.all([0, 3, 5, 6, 40].map(() => makeProduct(actor)));
    await Promise.all([0, 3, 5, 6, 40].map((n, i) => setStock(ps[i]!.id, "default", n)));
    const res = await list("lowStock=true");
    expect(res.status).toBe(200);
    const items = (await json(res)).items as Json[];
    expect(items.map((i) => i.available)).toEqual([0, 3, 5]);
    expect(items.map((i) => i.productId)).toEqual([ps[0]!.id, ps[1]!.id, ps[2]!.id]);
    const all = (await json(await list("lowStock=false&limit=50"))).items as Json[];
    expect(all).toHaveLength(5);
  });

  it("counts reserved stock against available for lowStock", async () => {
    const actor = await seed("owner");
    signIn(actor.uid);
    const p = await makeProduct(actor);
    await setStock(p.id, "default", 20);
    await reserveStock(actor.organizationId, p.id, "default", 15, "o1");
    const items = (await json(await list("lowStock=true"))).items as Json[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ onHand: 20, reserved: 15, available: 5 });
  });

  it("productId filters to that product's variants sorted by variant id", async () => {
    const actor = await seed("owner");
    signIn(actor.uid);
    const p = await makeProduct(actor, { variants: [{ size: "S" }, { size: "M" }, { size: "L" }] });
    await makeProduct(actor);
    const items = (await json(await list(`productId=${p.id}`))).items as Json[];
    expect(items.map((i) => i.variantId)).toEqual(p.variants.map((v) => v.id).sort());
  });

  it("400 for productId + lowStock=true, bad lowStock, bad limit and repeated params", async () => {
    const actor = await seed("viewer");
    signIn(actor.uid);
    expect((await list("productId=p1&lowStock=true")).status).toBe(400);
    expect((await list("productId=p1&lowStock=false")).status).toBe(200);
    expect((await list("lowStock=maybe")).status).toBe(400);
    expect((await list("limit=0")).status).toBe(400);
    expect((await list("limit=51")).status).toBe(400);
    expect((await list("productId=a%2Fb")).status).toBe(400);
    expect((await list("lowStock=true&lowStock=false")).status).toBe(400);
    expect((await list("cursor=not-a-cursor")).status).toBe(400);
  });

  it("paginates every sort without duplicates or gaps", async () => {
    const actor = await seed("owner");
    signIn(actor.uid);
    const ps = await Promise.all(
      Array.from({ length: 7 }, () =>
        makeProduct(actor, { variants: [{ size: "S" }, { size: "M" }] }),
      ),
    );
    await Promise.all(ps.map((p, i) => setStock(p.id, p.variants[0]!.id, i % 4)));

    async function walk(qs: string) {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 20; guard++) {
        const res: Response = await list(`${qs}limit=3${cursor ? `&cursor=${cursor}` : ""}`);
        expect(res.status).toBe(200);
        const body = await json(res);
        seen.push(...(body.items as Json[]).map((i) => i.id));
        cursor = body.nextCursor;
        if (!cursor) break;
      }
      return seen;
    }
    const all = await walk("");
    expect(all).toHaveLength(14);
    expect(new Set(all).size).toBe(14);

    const low = await walk("lowStock=true&"); // available <= 5: all 14 rows
    expect(low).toHaveLength(14);
    expect(new Set(low).size).toBe(14);

    const one = await walk(`productId=${ps[0]!.id}&`);
    expect(one).toHaveLength(2);
  });

  it("serves the service directly with a context (listInventory)", async () => {
    const actor = await seed("owner");
    const p = await makeProduct(actor);
    const page = await listInventory(actor, { productId: p.id });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
    await expect(listInventory({ organizationId: "", uid: "u" }, {})).rejects.toThrow();
  });
});
