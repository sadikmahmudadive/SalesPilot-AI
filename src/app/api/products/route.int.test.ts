import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/security/permissions";

import { POST as POST_CATEGORY } from "../categories/route";
import { DELETE, GET as GET_ONE, PATCH } from "./[id]/route";
import { GET, POST } from "./route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

const BASE = "http://localhost/api/products";
const orgs = new Set<string>();
const uids: string[] = [];
let counter = 0;
const BN_NAME = String.fromCodePoint(0x09b6, 0x09be, 0x09a1, 0x09bc, 0x09bf);

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
const post = (body: unknown, headers?: Record<string, string>) =>
  POST(send("POST", BASE, body, headers));
const list = (qs = "") => GET(send("GET", `${BASE}${qs ? `?${qs}` : ""}`));
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const getOne = (id: string) => GET_ONE(send("GET", `${BASE}/${id}`), idCtx(id));
const patchOne = (id: string, body: unknown) =>
  PATCH(send("PATCH", `${BASE}/${id}`, body), idCtx(id));
const del = (id: string) => DELETE(send("DELETE", `${BASE}/${id}`), idCtx(id));
const valid = (over: Record<string, unknown> = {}) => {
  counter += 1;
  return { name: `Prod ${counter}`, sku: `rt-${counter}`, regularPriceMinor: 5000, ...over };
};

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as Json;

beforeEach(() => {
  session = null;
});

afterAll(async () => {
  const db = adminDb();
  for (const org of orgs) {
    for (const col of [
      "products",
      "productSkus",
      "productSlugs",
      "inventory",
      "categories",
      "categoryNames",
      "auditLogs",
    ]) {
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

describe("authentication and permissions", () => {
  it("401 without a session on every method", async () => {
    expect((await list()).status).toBe(401);
    expect((await post(valid())).status).toBe(401);
    expect((await getOne("x")).status).toBe(401);
    expect((await patchOne("x", { name: "A" })).status).toBe(401);
    expect((await del("x")).status).toBe(401);
  });

  it("403 for a user without membership", async () => {
    signIn(`uid-${randomUUID()}`);
    expect((await list()).status).toBe(403);
    expect((await post(valid())).status).toBe(403);
  });

  it.each(["agent", "viewer"] as const)(
    "%s can read but not create, patch or delete",
    async (role) => {
      const owner = await seed("owner");
      signIn(owner.uid);
      const created = await json(await post(valid()));
      const member = await seed(role, owner.organizationId);
      signIn(member.uid);
      expect((await list()).status).toBe(200);
      expect((await getOne(created.id)).status).toBe(200);
      expect((await post(valid())).status).toBe(403);
      expect((await patchOne(created.id, { name: "Nope" })).status).toBe(403);
      expect((await del(created.id)).status).toBe(403);
      const after = await json(await getOne(created.id));
      expect(after).toMatchObject({ name: created.name, archived: false });
    },
  );

  it("admin can write", async () => {
    const admin = await seed("admin");
    signIn(admin.uid);
    expect((await post(valid())).status).toBe(201);
  });
});

describe("POST /api/products", () => {
  it("201 with the product, no-store and a request id; organizationId comes from membership", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const res = await post({
      ...valid({ name: "Linen Shirt", sku: " lin-1 " }),
      organizationId: "evil",
      slug: "evil",
      archived: true,
      id: "evil",
      nameLower: "evil",
      createdAt: "2000-01-01T00:00:00.000Z",
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const p = await json(res);
    expect(p).toMatchObject({
      organizationId: owner.organizationId,
      name: "Linen Shirt",
      sku: "LIN-1",
      slug: "linen-shirt",
      archived: false,
      availability: "draft",
    });
    expect(p.id).not.toBe("evil");
    expect(p.createdAt).not.toBe("2000-01-01T00:00:00.000Z");
    expect(p).not.toHaveProperty("nameLower");
  });

  it("409 for a duplicate SKU without leaking the other product", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const first = await json(await post(valid({ sku: "dup-9" })));
    const res = await post(valid({ sku: " DUP-9" }));
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error.code).toBe("CONFLICT");
    expect(JSON.stringify(body)).not.toContain(first.id);
  });

  it("400 for invalid bodies: float price, sale > regular, 11 images, foreign image host, bad variant", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const img = (n: number) => ({
      url: `https://res.cloudinary.com/demo/image/upload/organizations/${owner.organizationId}/products/i${n}.jpg`,
      publicId: `organizations/${owner.organizationId}/products/i${n}`,
      width: 10,
      height: 10,
    });
    const cases: Array<Record<string, unknown>> = [
      { regularPriceMinor: 10.5 },
      { regularPriceMinor: -1 },
      { regularPriceMinor: 100, salePriceMinor: 101 },
      { images: Array.from({ length: 11 }, (_, i) => img(i)) },
      { images: [{ ...img(1), url: "https://evil.example.com/a.jpg" }] },
      { images: [{ ...img(1), url: img(1).url.replace("https:", "http:") }] },
      { variants: [{ id: "A B", size: "M" }] },
      {
        variants: [
          { id: "a", size: "M" },
          { id: "a", size: "L" },
        ],
      },
      { specifications: JSON.parse('{"__proto__": "x"}') },
      { sku: "has space" },
    ];
    for (const over of cases) {
      const res = await post(valid(over));
      expect(res.status, JSON.stringify(over).slice(0, 80)).toBe(400);
    }
    expect((await post(valid({ images: [img(1)] }))).status).toBe(201);
  });

  it("400 for another organization's image publicId and for a foreign category", async () => {
    const a = await seed("owner");
    const b = await seed("owner");
    signIn(b.uid);
    const cat = await json(
      await POST_CATEGORY(send("POST", "http://localhost/api/categories", { name: "Theirs" })),
    );
    signIn(a.uid);
    const foreignImage = {
      url: `https://res.cloudinary.com/demo/image/upload/organizations/${b.organizationId}/products/x.jpg`,
      publicId: `organizations/${b.organizationId}/products/x`,
      width: 10,
      height: 10,
    };
    expect((await post(valid({ images: [foreignImage] }))).status).toBe(400);
    expect((await post(valid({ categoryId: cat.id }))).status).toBe(400);
  });

  it("415 without a JSON content type, 400 for malformed JSON", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const res = await POST(
      new Request(BASE, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }),
    );
    expect(res.status).toBe(415);
    expect((await post("{not json")).status).toBe(400);
  });

  it("accepts Bangla names", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const p = await json(await post(valid({ name: BN_NAME })));
    expect(p).toMatchObject({ name: BN_NAME, slug: BN_NAME });
  });
});

describe("GET/PATCH/DELETE /api/products/[id]", () => {
  it("GET returns the product; invalid and unknown ids are 404", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const p = await json(await post(valid()));
    const res = await getOne(p.id);
    expect(res.status).toBe(200);
    expect((await json(res)).id).toBe(p.id);
    expect((await getOne("missing-id")).status).toBe(404);
    expect((await getOne("a%2Fb")).status).toBe(404);
    expect((await getOne("..")).status).toBe(404);
  });

  it("another organization's product is 404 for GET, PATCH and DELETE, and stays untouched", async () => {
    const a = await seed("owner");
    const b = await seed("owner");
    signIn(a.uid);
    const p = await json(await post(valid()));
    signIn(b.uid);
    expect((await getOne(p.id)).status).toBe(404);
    expect((await patchOne(p.id, { name: "Hijack" })).status).toBe(404);
    expect((await del(p.id)).status).toBe(404);
    signIn(a.uid);
    expect(await json(await getOne(p.id))).toMatchObject({ name: p.name, archived: false });
  });

  it("PATCH updates fields, clears with null, ignores managed fields and keeps the slug", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const p = await json(
      await post(valid({ name: "Stable Slug", description: "d", salePriceMinor: 100 })),
    );
    const res = await patchOne(p.id, {
      name: "Renamed",
      description: null,
      salePriceMinor: null,
      slug: "evil",
      archived: true,
      organizationId: "evil",
    });
    expect(res.status).toBe(200);
    const u = await json(res);
    expect(u).toMatchObject({
      name: "Renamed",
      slug: "stable-slug",
      archived: false,
      organizationId: owner.organizationId,
    });
    expect(u).not.toHaveProperty("description");
    expect(u).not.toHaveProperty("salePriceMinor");
  });

  it("PATCH 400 for an empty patch, null on a required field and sale > regular after merging", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const p = await json(await post(valid({ regularPriceMinor: 1000, salePriceMinor: 900 })));
    expect((await patchOne(p.id, {})).status).toBe(400);
    expect((await patchOne(p.id, { slug: "x" })).status).toBe(400);
    expect((await patchOne(p.id, { name: null })).status).toBe(400);
    expect((await patchOne(p.id, { salePriceMinor: 1001 })).status).toBe(400);
    expect((await patchOne(p.id, { regularPriceMinor: 800 })).status).toBe(400);
    expect((await patchOne(p.id, { regularPriceMinor: 800, salePriceMinor: 700 })).status).toBe(
      200,
    );
  });

  it("PATCH 409 when the new SKU is taken and when removing a variant that has stock", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    await post(valid({ sku: "taken-1" }));
    const p = await json(
      await post(
        valid({
          variants: [
            { id: "m", size: "M" },
            { id: "l", size: "L" },
          ],
        }),
      ),
    );
    expect((await patchOne(p.id, { sku: "taken-1" })).status).toBe(409);

    await adminDb().collection("inventory").doc(`${p.id}__l`).update({ onHand: 2, available: 2 });
    expect((await patchOne(p.id, { variants: [{ id: "m", size: "M" }] })).status).toBe(409);
    expect((await json(await getOne(p.id))).variants).toHaveLength(2);
  });

  it("DELETE archives (200 with the archived product); the product stays readable and un-archivable", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const p = await json(await post(valid({ availability: "active" })));
    const res = await del(p.id);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ id: p.id, archived: true, availability: "archived" });
    expect((await del(p.id)).status).toBe(200); // idempotent
    expect(await json(await getOne(p.id))).toMatchObject({ archived: true });

    expect((await list()).status).toBe(200);
    expect((await json(await list())).items.map((x: Json) => x.id)).not.toContain(p.id);
    expect((await json(await list("archived=true"))).items.map((x: Json) => x.id)).toContain(p.id);

    const restored = await json(await patchOne(p.id, { availability: "active" }));
    expect(restored).toMatchObject({ archived: false, availability: "active" });
    expect((await json(await list())).items.map((x: Json) => x.id)).toContain(p.id);
    // No hard delete: the document still exists in storage.
    expect((await adminDb().collection("products").doc(p.id).get()).exists).toBe(true);
  });
});

describe("GET /api/products", () => {
  it("lists with pagination, filters, search and sort", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    const cat = await json(
      await POST_CATEGORY(send("POST", "http://localhost/api/categories", { name: "Tops" })),
    );
    const made: Json[] = [];
    for (let i = 0; i < 5; i++) {
      made.push(
        await json(
          await post(
            valid({
              name: `Item ${i}`,
              availability: i % 2 === 0 ? "active" : "draft",
              ...(i < 2 ? { categoryId: cat.id } : {}),
            }),
          ),
        ),
      );
    }

    const seen: string[] = [];
    let cursor = "";
    do {
      const page = await json(
        await list(`limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
      );
      seen.push(...page.items.map((x: Json) => x.id));
      cursor = page.nextCursor ?? "";
    } while (cursor);
    expect(new Set(seen).size).toBe(5);

    const active = await json(await list("availability=active"));
    expect(active.items.map((x: Json) => x.id).sort()).toEqual(
      [made[0]!.id, made[2]!.id, made[4]!.id].sort(),
    );
    const inCat = await json(await list(`categoryId=${cat.id}`));
    expect(inCat.items.map((x: Json) => x.id).sort()).toEqual([made[0]!.id, made[1]!.id].sort());
    const search = await json(await list("q=item%203"));
    expect(search.items.map((x: Json) => x.id)).toEqual([made[3]!.id]);
    const bySku = await json(await list(`sku=${made[1]!.sku.toLowerCase()}`));
    expect(bySku.items.map((x: Json) => x.id)).toEqual([made[1]!.id]);
    const byName = await json(await list("sort=name&dir=asc"));
    expect(byName.items.map((x: Json) => x.name)).toEqual([
      "Item 0",
      "Item 1",
      "Item 2",
      "Item 3",
      "Item 4",
    ]);
    expect((await json(await list("limit=2"))).items).toHaveLength(2);
  });

  it("is scoped to the caller's organization", async () => {
    const a = await seed("owner");
    const b = await seed("viewer");
    signIn(a.uid);
    await post(valid());
    signIn(b.uid);
    expect((await json(await list())).items).toEqual([]);
  });

  it("400 for two filters, search with a filter, both searches, repeated params, bad values", async () => {
    const owner = await seed("owner");
    signIn(owner.uid);
    for (const qs of [
      "availability=active&categoryId=abc",
      "q=a&availability=active",
      "sku=a&categoryId=abc",
      "q=a&sku=b",
      "q=a&q=b",
      "archived=true&archived=false",
      "archived=yes",
      "limit=51",
      "limit=0",
      "sort=price",
      "availability=sold",
      "cursor=garbage",
    ]) {
      expect((await list(qs)).status, qs).toBe(400);
    }
    expect((await list("unknown=1&q=")).status).toBe(200);
  });
});
