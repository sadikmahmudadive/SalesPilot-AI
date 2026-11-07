import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { __resetEnvCacheForTests } from "@/config/env";
import { uploadRecordRef } from "@/lib/cloudinary/records";
import { adminDb } from "@/lib/firebase/admin";
import { categoryInputSchema, productInputSchema, productPatchSchema } from "@/schemas/product";
import { seedUpload } from "@/test/uploads";

import { createCategory, listCategories } from "./categories";
import { archiveProduct, createProduct, getProduct, listProducts, updateProduct } from "./products";

// Failure seam: lets a test make the in-transaction audit write throw, to prove that nothing
// else in the same transaction (product, locks, inventory) survives.
const audit = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/security/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/audit")>();
  return {
    ...actual,
    writeAuditInTransaction: (...args: Parameters<typeof actual.writeAuditInTransaction>) => {
      if (audit.fail) throw new Error("audit unavailable");
      return actual.writeAuditInTransaction(...args);
    },
  };
});

const BN_NAME = String.fromCodePoint(0x09b6, 0x09be, 0x09a1, 0x09bc, 0x09bf);

const orgs: string[] = [];
function newCtx() {
  const organizationId = `org-${randomUUID()}`;
  orgs.push(organizationId);
  return { organizationId, uid: `uid-${randomUUID()}` };
}
type Ctx = ReturnType<typeof newCtx>;

let counter = 0;
function make(over: Record<string, unknown> = {}) {
  counter += 1;
  return productInputSchema.parse({
    name: `Product ${counter}`,
    sku: `sku-${counter}`,
    regularPriceMinor: 100000,
    ...over,
  });
}
const patch = (p: Record<string, unknown>) => productPatchSchema.parse(p);
const image = (orgId: string, n = 1) => ({
  url: `https://res.cloudinary.com/demo/image/upload/v1/organizations/${orgId}/products/p${n}.jpg`,
  publicId: `organizations/${orgId}/products/p${n}`,
  width: 800,
  height: 600,
});

const db = () => adminDb();
async function docsOf(collection: string, organizationId: string) {
  return (await db().collection(collection).where("organizationId", "==", organizationId).get())
    .docs;
}
const inventoryOf = async (ctx: Ctx, productId: string) =>
  (await docsOf("inventory", ctx.organizationId)).filter((d) => d.get("productId") === productId);
const skuLock = (org: string, sku: string) => db().collection("productSkus").doc(`${org}_${sku}`);
const slugLock = (org: string, slug: string) =>
  db().collection("productSlugs").doc(`${org}_${slug}`);
const countAll = async (ctx: Ctx) => ({
  products: (await docsOf("products", ctx.organizationId)).length,
  skus: (await docsOf("productSkus", ctx.organizationId)).length,
  slugs: (await docsOf("productSlugs", ctx.organizationId)).length,
  inventory: (await docsOf("inventory", ctx.organizationId)).length,
  audits: (await docsOf("auditLogs", ctx.organizationId)).length,
});
const rejection = async (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

beforeEach(() => {
  audit.fail = false;
});

afterAll(async () => {
  const collections = [
    "products",
    "productSkus",
    "productSlugs",
    "inventory",
    "categories",
    "categoryNames",
    "auditLogs",
    "uploads",
  ];
  await Promise.all(
    orgs.flatMap((org) =>
      collections.map(async (col) => {
        const docs = await docsOf(col, org);
        await Promise.all(docs.map((d) => db().recursiveDelete(d.ref)));
      }),
    ),
  );
}, 60_000);

describe("createProduct", () => {
  it("stores managed fields, locks, a default inventory doc and one audit entry", async () => {
    const ctx = newCtx();
    const p = await createProduct(
      ctx,
      make({
        name: "  Cotton   Shirt ",
        sku: " sh-1 ",
        description: "Soft cotton",
        wholesalePriceMinor: 80000,
      }),
    );

    expect(p).toMatchObject({
      name: "Cotton   Shirt", // only trimmed: inner spacing is kept in the display name
      sku: "SH-1",
      slug: "cotton-shirt",
      archived: false,
      availability: "draft",
      organizationId: ctx.organizationId,
      regularPriceMinor: 100000,
      wholesalePriceMinor: 80000,
      images: [],
      variants: [],
      specifications: {},
      faqs: [],
    });
    expect(p.createdAt).toMatch(/^\d{4}-/);
    expect(p).not.toHaveProperty("nameLower");
    expect(p).not.toHaveProperty("skuLower");

    const raw = (await db().collection("products").doc(p.id).get()).data()!;
    expect(raw.nameLower).toBe("cotton shirt");
    expect(raw.skuLower).toBe("sh-1");

    expect((await skuLock(ctx.organizationId, "SH-1").get()).data()).toMatchObject({
      organizationId: ctx.organizationId,
      productId: p.id,
    });
    expect((await slugLock(ctx.organizationId, "cotton-shirt").get()).data()).toMatchObject({
      organizationId: ctx.organizationId,
      productId: p.id,
    });

    const logs = await docsOf("auditLogs", ctx.organizationId);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.data()).toMatchObject({
      actorUid: ctx.uid,
      action: "product.create",
      resource: "product",
      resourceId: p.id,
      after: {
        sku: "SH-1",
        availability: "draft",
        regularPriceMinor: 100000,
        wholesalePriceMinor: 80000,
      },
    });
    expect(logs[0]!.get("after.changedFields")).toEqual(
      expect.arrayContaining(["name", "sku", "description"]),
    );
    expect(JSON.stringify(logs[0]!.data())).not.toContain("Soft cotton");
  });

  it("never stores client-supplied managed fields (organizationId, slug, archived...)", async () => {
    const ctx = newCtx();
    const input = productInputSchema.parse({
      ...make(),
      organizationId: "evil",
      slug: "evil",
      archived: true,
      nameLower: "evil",
      id: "evil",
    });
    const p = await createProduct(ctx, input);
    expect(p).toMatchObject({ organizationId: ctx.organizationId, archived: false });
    expect(p.slug).not.toBe("evil");
    // Even when the service is handed an unparsed object.
    const sneaky = {
      ...make(),
      organizationId: "evil",
      slug: "evil",
      archived: true,
      skuLower: "x",
    };
    const q = await createProduct(ctx, sneaky as never);
    expect(q).toMatchObject({ organizationId: ctx.organizationId, archived: false });
    expect(q.slug).not.toBe("evil");
  });

  it("creates an archived product when availability is archived (archived invariant)", async () => {
    const ctx = newCtx();
    const p = await createProduct(ctx, make({ availability: "archived" }));
    expect(p).toMatchObject({ availability: "archived", archived: true });
  });

  it("rejects a duplicate SKU (case and whitespace insensitive) with a static ConflictError", async () => {
    const ctx = newCtx();
    await createProduct(ctx, make({ sku: "dup-1" }));
    const err = await rejection(createProduct(ctx, make({ sku: "  DUP-1 " })));
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as Error).message).toBe("A product with this SKU already exists");
    expect(await countAll(ctx)).toEqual({
      products: 1,
      skus: 1,
      slugs: 1,
      inventory: 1,
      audits: 1,
    });
  });

  it("10 concurrent creates of one SKU: exactly one product, one lock, one audit row", async () => {
    const ctx = newCtx();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        createProduct(ctx, make({ name: `Racer ${i}`, sku: "RACE-1" })),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ConflictError);
    }
    expect(await countAll(ctx)).toEqual({
      products: 1,
      skus: 1,
      slugs: 1,
      inventory: 1,
      audits: 1,
    });
  });

  it("the same SKU is allowed in another organization", async () => {
    const a = newCtx();
    const b = newCtx();
    const pa = await createProduct(a, make({ sku: "SHARED", name: "Same Name" }));
    const pb = await createProduct(b, make({ sku: "SHARED", name: "Same Name" }));
    expect(pa.id).not.toBe(pb.id);
    expect(pa.slug).toBe("same-name");
    expect(pb.slug).toBe("same-name"); // slugs are per organization too
  });

  it("gives colliding names -2 and -3 slugs", async () => {
    const ctx = newCtx();
    const slugs: string[] = [];
    for (const sku of ["a1", "a2", "a3"])
      slugs.push((await createProduct(ctx, make({ name: "Red Shirt", sku }))).slug);
    expect(slugs).toEqual(["red-shirt", "red-shirt-2", "red-shirt-3"]);
  });

  it("concurrent creates with the same name get distinct slugs", async () => {
    const ctx = newCtx();
    const created = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createProduct(ctx, make({ name: "Blue Shirt", sku: `blue-${i}` })),
      ),
    );
    const slugs = created.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(5);
    expect(slugs.every((s) => /^blue-shirt(-\d|-[0-9a-f]{6})?$/.test(s))).toBe(true);
    expect(await countAll(ctx)).toEqual({
      products: 5,
      skus: 5,
      slugs: 5,
      inventory: 5,
      audits: 5,
    });
  });

  it("derives Bangla slugs and falls back to the SKU when the name has no letters", async () => {
    const ctx = newCtx();
    const bn = await createProduct(ctx, make({ name: BN_NAME }));
    expect(bn.slug).toBe(BN_NAME);
    const symbols = await createProduct(ctx, make({ name: "!!!", sku: "Zed.9" }));
    expect(symbols.slug).toBe("zed9");
    const nothing = await createProduct(ctx, make({ name: "???", sku: "..." }));
    expect(nothing.slug).toBe("product");
  });

  it("10 truly concurrent same-name creates with distinct SKUs all succeed with distinct slugs", async () => {
    const ctx = newCtx();
    const created = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createProduct(ctx, make({ name: "Hot Shirt", sku: `hot-${i}` })),
      ),
    );
    const slugs = created.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(10);
    expect(slugs.every((s) => /^hot-shirt(-\d|-[0-9a-f]{6})?$/.test(s))).toBe(true);
    expect(await countAll(ctx)).toEqual({
      products: 10,
      skus: 10,
      slugs: 10,
      inventory: 10,
      audits: 10,
    });
  });

  it("more than 20 same-name products created one after another all succeed", async () => {
    const ctx = newCtx();
    const slugs: string[] = [];
    for (let i = 0; i < 24; i++) {
      slugs.push((await createProduct(ctx, make({ name: "Same Name", sku: `same-${i}` }))).slug);
    }
    expect(slugs.slice(0, 5)).toEqual([
      "same-name",
      "same-name-2",
      "same-name-3",
      "same-name-4",
      "same-name-5",
    ]);
    expect(slugs.slice(5).every((s) => /^same-name-[0-9a-f]{6}$/.test(s))).toBe(true);
    expect(new Set(slugs).size).toBe(24);
    expect((await countAll(ctx)).slugs).toBe(24);
  });

  it("a taken SKU is still a ConflictError when it is lost together with a slug race", async () => {
    const ctx = newCtx();
    const results = await Promise.allSettled([
      createProduct(ctx, make({ name: "Dup Race", sku: "dr-1" })),
      createProduct(ctx, make({ name: "Dup Race", sku: "dr-1" })),
      createProduct(ctx, make({ name: "Dup Race", sku: "dr-2" })),
    ]);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect((await countAll(ctx)).products).toBe(2);
  });

  it("gives up with a static ConflictError when every commit keeps hitting ALREADY_EXISTS", async () => {
    const ctx = newCtx();
    const spy = vi
      .spyOn(adminDb(), "runTransaction")
      .mockRejectedValue(Object.assign(new Error("exists"), { code: 6 }));
    try {
      const err = await rejection(createProduct(ctx, make()));
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as Error).message).toBe(
        "The product could not be saved because of a concurrent change; please try again",
      );
      expect(spy).toHaveBeenCalledTimes(5);
    } finally {
      spy.mockRestore();
    }
    expect((await countAll(ctx)).products).toBe(0);
  });

  it("creates exactly one inventory doc per variant (and none for default)", async () => {
    const ctx = newCtx();
    const p = await createProduct(
      ctx,
      make({ variants: [{ size: "M" }, { id: "blue-l", size: "L", color: "Blue" }] }),
    );
    expect(p.variants).toHaveLength(2);
    expect(p.variants[0]!.id).toMatch(/^v-[0-9a-f]{8}$/);
    expect(p.variants[1]!.id).toBe("blue-l");

    const inv = await inventoryOf(ctx, p.id);
    expect(inv.map((d) => d.id).sort()).toEqual(
      [`${p.id}__${p.variants[0]!.id}`, `${p.id}__blue-l`].sort(),
    );
    for (const d of inv) {
      expect(d.data()).toMatchObject({
        organizationId: ctx.organizationId,
        productId: p.id,
        onHand: 0,
        reserved: 0,
        available: 0,
      });
      expect(d.get("createdAt")).toBeDefined();
    }
    expect(inv.some((d) => d.get("variantId") === "default")).toBe(false);
  });

  it("creates one default inventory doc for a product without variants", async () => {
    const ctx = newCtx();
    const p = await createProduct(ctx, make());
    const inv = await inventoryOf(ctx, p.id);
    expect(inv).toHaveLength(1);
    expect(inv[0]!.id).toBe(`${p.id}__default`);
    expect(inv[0]!.data()).toMatchObject({
      variantId: "default",
      onHand: 0,
      reserved: 0,
      available: 0,
    });
  });

  it("accepts images of the own organization and rejects another organization's publicId", async () => {
    const ctx = newCtx();
    const other = newCtx();
    const ok = await createProduct(
      ctx,
      make({ images: [await seedUpload(ctx.organizationId, image(ctx.organizationId))] }),
    );
    expect(ok.images).toHaveLength(1);

    const err = await rejection(
      createProduct(ctx, make({ images: [image(other.organizationId)] })),
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect((await countAll(ctx)).products).toBe(1);

    // A service caller bypassing the schema still cannot slip through traversal or a foreign URL.
    const traversal = {
      ...image(ctx.organizationId),
      publicId: `organizations/${ctx.organizationId}/products/../../${other.organizationId}/products/x`,
    };
    traversal.url = `https://res.cloudinary.com/demo/image/upload/${traversal.publicId}.jpg`;
    const bad = { ...make(), images: [traversal] };
    expect(await rejection(createProduct(ctx, bad as never))).toBeInstanceOf(ValidationError);
    const foreignUrl = { ...image(ctx.organizationId), url: image(other.organizationId).url };
    expect(
      await rejection(createProduct(ctx, { ...make(), images: [foreignUrl] } as never)),
    ).toBeInstanceOf(ValidationError);
  });

  it("rejects the same image attached twice, on create and on update", async () => {
    const ctx = newCtx();
    const dup = [image(ctx.organizationId, 1), image(ctx.organizationId, 1)];
    const raw = { ...make(), images: dup };
    expect(await rejection(createProduct(ctx, raw as never))).toBeInstanceOf(ValidationError);
    const p = await createProduct(ctx, make());
    const sneaky = { images: dup } as never;
    expect(await rejection(updateProduct(ctx, p.id, sneaky))).toBeInstanceOf(ValidationError);
  });

  describe("confirmed uploads", () => {
    it("rejects an image with no confirmed upload record, on create and on update", async () => {
      const ctx = newCtx();
      const img = image(ctx.organizationId, 7); // never confirmed
      const err = await rejection(createProduct(ctx, make({ images: [img] })));
      expect(err).toBeInstanceOf(ValidationError);
      expect(JSON.stringify((err as ValidationError).details)).toContain("images");
      expect((await countAll(ctx)).products).toBe(0);

      const p = await createProduct(ctx, make());
      expect(await rejection(updateProduct(ctx, p.id, patch({ images: [img] })))).toBeInstanceOf(
        ValidationError,
      );
      expect(await getProduct(ctx, p.id)).toMatchObject({ images: [] });
    });

    it("rejects another organization's confirmed record, a non-product record and a mismatched one", async () => {
      const ctx = newCtx();
      const other = newCtx();
      const img = image(ctx.organizationId, 8);
      const cases: Array<Record<string, unknown>> = [
        { organizationId: other.organizationId },
        { kind: "customers" },
        { publicId: `${img.publicId}x` },
        { url: 42 },
        { width: 1.5 },
      ];
      for (const over of cases) {
        await seedUpload(ctx.organizationId, img, over);
        expect(await rejection(createProduct(ctx, make({ images: [img] })))).toBeInstanceOf(
          ValidationError,
        );
      }
      expect((await countAll(ctx)).products).toBe(0);
    });

    it("stores url and dimensions from the record, not from the client", async () => {
      const ctx = newCtx();
      const confirmed = await seedUpload(ctx.organizationId, image(ctx.organizationId, 9));
      const claimed = {
        ...confirmed,
        url: confirmed.url.replace(".jpg", ".png"),
        width: 1,
        height: 1,
      };
      const created = await createProduct(ctx, make({ images: [claimed] }));
      expect(created.images).toEqual([confirmed]);

      const p = await createProduct(ctx, make());
      const updated = await updateProduct(ctx, p.id, patch({ images: [claimed] }));
      expect(updated.images).toEqual([confirmed]);
    });

    it("an update that leaves images alone needs no record", async () => {
      const ctx = newCtx();
      const img = await seedUpload(ctx.organizationId, image(ctx.organizationId, 10));
      const p = await createProduct(ctx, make({ images: [img] }));
      await uploadRecordRef(img.publicId).delete();
      const updated = await updateProduct(ctx, p.id, patch({ name: "Renamed" }));
      expect(updated.images).toEqual([img]);
    });
  });

  describe("Cloudinary cloud binding", () => {
    const stubCloud = (name: string) => {
      vi.stubEnv("CLOUDINARY_CLOUD_NAME", name);
      vi.stubEnv("CLOUDINARY_API_KEY", "key");
      vi.stubEnv("CLOUDINARY_API_SECRET", "secret");
      __resetEnvCacheForTests();
    };
    afterEach(() => {
      vi.unstubAllEnvs();
      __resetEnvCacheForTests();
    });

    it("accepts an image of the configured cloud", async () => {
      const ctx = newCtx();
      stubCloud("demo");
      const img = await seedUpload(ctx.organizationId, image(ctx.organizationId));
      const p = await createProduct(ctx, make({ images: [img] }));
      expect(p.images).toHaveLength(1);
    });

    it("rejects an image of a foreign cloud, even under the callers own folder", async () => {
      const ctx = newCtx();
      stubCloud("mine");
      // Even with a confirmed record, cloud "demo" is not "mine".
      const foreign = await seedUpload(ctx.organizationId, image(ctx.organizationId));
      expect(await rejection(createProduct(ctx, make({ images: [foreign] })))).toBeInstanceOf(
        ValidationError,
      );
      const p = await createProduct(ctx, make());
      expect(
        await rejection(updateProduct(ctx, p.id, patch({ images: [foreign] }))),
      ).toBeInstanceOf(ValidationError);
      expect((await countAll(ctx)).products).toBe(1);
    });

    it("unconfigured keeps the shape check only (any cloud name passes)", async () => {
      const ctx = newCtx();
      for (const key of ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) {
        vi.stubEnv(key, "");
      }
      __resetEnvCacheForTests();
      const other = image(ctx.organizationId).url.replace("/demo/", "/anything/");
      const img = await seedUpload(ctx.organizationId, {
        ...image(ctx.organizationId),
        url: other,
      });
      const p = await createProduct(ctx, make({ images: [img] }));
      expect(p.images).toHaveLength(1);
    });
  });

  it("requires the category to exist in the same organization", async () => {
    const ctx = newCtx();
    const other = newCtx();
    const mine = await createCategory(ctx, categoryInputSchema.parse({ name: "Shirts" }));
    const theirs = await createCategory(other, categoryInputSchema.parse({ name: "Shirts" }));

    expect((await createProduct(ctx, make({ categoryId: mine.id }))).categoryId).toBe(mine.id);
    expect(await rejection(createProduct(ctx, make({ categoryId: theirs.id })))).toBeInstanceOf(
      ValidationError,
    );
    expect(
      await rejection(createProduct(ctx, make({ categoryId: "does-not-exist" }))),
    ).toBeInstanceOf(ValidationError);
    expect((await countAll(ctx)).products).toBe(1);
  });

  it("persists nothing (product, locks, inventory) when the audit write fails", async () => {
    const ctx = newCtx();
    audit.fail = true;
    await expect(
      createProduct(ctx, make({ variants: [{ size: "M" }, { size: "L" }] })),
    ).rejects.toThrow("audit unavailable");
    expect(await countAll(ctx)).toEqual({
      products: 0,
      skus: 0,
      slugs: 0,
      inventory: 0,
      audits: 0,
    });
  });
});

describe("updateProduct", () => {
  it("patches fields, recomputes nameLower and keeps the slug stable", async () => {
    const ctx = newCtx();
    const p = await createProduct(ctx, make({ name: "Old Name" }));
    const u = await updateProduct(
      ctx,
      p.id,
      patch({ name: "Brand New Name", description: "d", regularPriceMinor: 5 }),
    );
    expect(u).toMatchObject({
      name: "Brand New Name",
      slug: "old-name",
      regularPriceMinor: 5,
      description: "d",
    });
    expect(u.updatedAt >= p.updatedAt).toBe(true);
    expect((await db().collection("products").doc(p.id).get()).get("nameLower")).toBe(
      "brand new name",
    );
    // The old slug lock stays; no new slug lock is created.
    expect((await docsOf("productSlugs", ctx.organizationId)).map((d) => d.id)).toEqual([
      `${ctx.organizationId}_old-name`,
    ]);
  });

  it("clears optional fields with null", async () => {
    const ctx = newCtx();
    const cat = await createCategory(ctx, categoryInputSchema.parse({ name: "C" }));
    const p = await createProduct(
      ctx,
      make({ description: "d", salePriceMinor: 10, wholesalePriceMinor: 20, categoryId: cat.id }),
    );
    const u = await updateProduct(
      ctx,
      p.id,
      patch({
        description: null,
        salePriceMinor: null,
        wholesalePriceMinor: null,
        categoryId: null,
      }),
    );
    for (const key of ["description", "salePriceMinor", "wholesalePriceMinor", "categoryId"]) {
      expect(u).not.toHaveProperty(key);
    }
    const raw = (await db().collection("products").doc(p.id).get()).data()!;
    expect("description" in raw).toBe(false);
  });

  it("validates sale <= regular against the merged result", async () => {
    const ctx = newCtx();
    const p = await createProduct(ctx, make({ regularPriceMinor: 1000, salePriceMinor: 900 }));
    // Only the sale price in the patch.
    expect(
      await rejection(updateProduct(ctx, p.id, patch({ salePriceMinor: 1001 }))),
    ).toBeInstanceOf(ValidationError);
    // Only the regular price in the patch, below the stored sale price.
    expect(
      await rejection(updateProduct(ctx, p.id, patch({ regularPriceMinor: 899 }))),
    ).toBeInstanceOf(ValidationError);
    // Lowering both, or clearing the sale price first, is fine.
    expect(
      (await updateProduct(ctx, p.id, patch({ regularPriceMinor: 500, salePriceMinor: 400 })))
        .salePriceMinor,
    ).toBe(400);
    expect(
      (await updateProduct(ctx, p.id, patch({ salePriceMinor: null, regularPriceMinor: 100 })))
        .regularPriceMinor,
    ).toBe(100);
    expect((await getProduct(ctx, p.id)).regularPriceMinor).toBe(100);
  });

  it("moves the SKU lock atomically and frees the old SKU", async () => {
    const ctx = newCtx();
    const p = await createProduct(ctx, make({ sku: "old-1" }));
    const u = await updateProduct(ctx, p.id, patch({ sku: " new-1 " }));
    expect(u.sku).toBe("NEW-1");
    expect((await db().collection("products").doc(p.id).get()).get("skuLower")).toBe("new-1");
    expect((await skuLock(ctx.organizationId, "OLD-1").get()).exists).toBe(false);
    expect((await skuLock(ctx.organizationId, "NEW-1").get()).get("productId")).toBe(p.id);
    // The old SKU can be used again.
    expect((await createProduct(ctx, make({ sku: "old-1" }))).sku).toBe("OLD-1");
  });

  it("rejects a SKU taken by another product and changes nothing", async () => {
    const ctx = newCtx();
    const a = await createProduct(ctx, make({ sku: "a-1" }));
    await createProduct(ctx, make({ sku: "b-1" }));
    const err = await rejection(updateProduct(ctx, a.id, patch({ sku: "B-1", name: "Renamed" })));
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as Error).message).toBe("A product with this SKU already exists");
    const after = await getProduct(ctx, a.id);
    expect(after).toMatchObject({ sku: "A-1" });
    expect(after.name).not.toBe("Renamed");
    expect((await skuLock(ctx.organizationId, "A-1").get()).exists).toBe(true);
  });

  it("two concurrent PATCHes moving different products to one new SKU: one wins, one conflicts", async () => {
    const ctx = newCtx();
    const a = await createProduct(ctx, make({ sku: "pa-1" }));
    const b = await createProduct(ctx, make({ sku: "pb-1" }));
    const results = await Promise.allSettled([
      updateProduct(ctx, a.id, patch({ sku: "target-1" })),
      updateProduct(ctx, b.id, patch({ sku: "target-1" })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);
    expect((lost.reason as Error).message).toBe("A product with this SKU already exists");

    const winner = results[0]!.status === "fulfilled" ? a : b;
    const loser = winner === a ? b : a;
    expect((await skuLock(ctx.organizationId, "TARGET-1").get()).get("productId")).toBe(winner.id);
    expect((await getProduct(ctx, loser.id)).sku).toBe(loser.sku);
    expect((await skuLock(ctx.organizationId, loser.sku).get()).get("productId")).toBe(loser.id);
    expect((await skuLock(ctx.organizationId, winner.sku).get()).exists).toBe(false);
  });

  it("setting the same SKU again is a no-op for the locks", async () => {
    const ctx = newCtx();
    const p = await createProduct(ctx, make({ sku: "same-1" }));
    await updateProduct(ctx, p.id, patch({ sku: "SAME-1" }));
    expect((await docsOf("productSkus", ctx.organizationId)).map((d) => d.id)).toEqual([
      `${ctx.organizationId}_SAME-1`,
    ]);
  });

  it("availability keeps the archived flag in step (un-archive via PATCH)", async () => {
    const ctx = newCtx();
    const p = await createProduct(ctx, make());
    expect(await updateProduct(ctx, p.id, patch({ availability: "archived" }))).toMatchObject({
      archived: true,
    });
    expect(await updateProduct(ctx, p.id, patch({ availability: "active" }))).toMatchObject({
      archived: false,
      availability: "active",
    });
  });

  it("adding a variant creates its inventory doc", async () => {
    const ctx = newCtx();
    const p = await createProduct(ctx, make({ variants: [{ id: "m", size: "M" }] }));
    const u = await updateProduct(
      ctx,
      p.id,
      patch({
        variants: [
          { id: "m", size: "M" },
          { id: "l", size: "L" },
        ],
      }),
    );
    expect(u.variants.map((v) => v.id)).toEqual(["m", "l"]);
    const inv = await inventoryOf(ctx, p.id);
    expect(inv.map((d) => d.id).sort()).toEqual([`${p.id}__l`, `${p.id}__m`]);
    expect(inv.find((d) => d.id === `${p.id}__l`)!.data()).toMatchObject({
      onHand: 0,
      reserved: 0,
      available: 0,
      variantId: "l",
    });
  });

  it("assigns ids to variants sent without one (a NEW variant)", async () => {
    const ctx = newCtx();
    const p = await createProduct(ctx, make({ variants: [{ id: "m", size: "M" }] }));
    const u = await updateProduct(
      ctx,
      p.id,
      patch({ variants: [{ id: "m", size: "M" }, { color: "Red" }] }),
    );
    expect(u.variants[1]!.id).toMatch(/^v-[0-9a-f]{8}$/);
    expect(await inventoryOf(ctx, p.id)).toHaveLength(2);
  });

  it("refuses to remove a variant whose inventory has stock, changing nothing", async () => {
    const ctx = newCtx();
    const p = await createProduct(
      ctx,
      make({
        variants: [
          { id: "m", size: "M" },
          { id: "l", size: "L" },
        ],
      }),
    );
    await db().collection("inventory").doc(`${p.id}__l`).update({ onHand: 5, available: 5 });

    const err = await rejection(
      updateProduct(ctx, p.id, patch({ variants: [{ id: "m", size: "M" }], name: "Changed" })),
    );
    expect(err).toBeInstanceOf(ConflictError);
    const after = await getProduct(ctx, p.id);
    expect(after.variants.map((v) => v.id)).toEqual(["m", "l"]);
    expect(after.name).not.toBe("Changed");
    expect((await inventoryOf(ctx, p.id)).map((d) => d.id).sort()).toEqual([
      `${p.id}__l`,
      `${p.id}__m`,
    ]);
    expect((await db().collection("inventory").doc(`${p.id}__l`).get()).get("onHand")).toBe(5);
  });

  it("refuses to remove a variant that only has reserved units or reservation records", async () => {
    const ctx = newCtx();
    const p = await createProduct(
      ctx,
      make({
        variants: [
          { id: "m", size: "M" },
          { id: "l", size: "L" },
        ],
      }),
    );
    await db().collection("inventory").doc(`${p.id}__l`).update({ reserved: 1 });
    expect(
      await rejection(updateProduct(ctx, p.id, patch({ variants: [{ id: "m", size: "M" }] }))),
    ).toBeInstanceOf(ConflictError);

    await db().collection("inventory").doc(`${p.id}__l`).update({ reserved: 0 });
    await db()
      .collection("inventory")
      .doc(`${p.id}__l`)
      .collection("reservations")
      .doc("order-1")
      .set({ qty: 1 });
    expect(
      await rejection(updateProduct(ctx, p.id, patch({ variants: [{ id: "m", size: "M" }] }))),
    ).toBeInstanceOf(ConflictError);
  });

  it("removes a zero-stock variant and deletes its inventory doc", async () => {
    const ctx = newCtx();
    const p = await createProduct(
      ctx,
      make({
        variants: [
          { id: "m", size: "M" },
          { id: "l", size: "L" },
        ],
      }),
    );
    const u = await updateProduct(ctx, p.id, patch({ variants: [{ id: "m", size: "M" }] }));
    expect(u.variants.map((v) => v.id)).toEqual(["m"]);
    expect((await inventoryOf(ctx, p.id)).map((d) => d.id)).toEqual([`${p.id}__m`]);
  });

  it("no variants -> variants: the empty default doc is replaced; stock on it blocks the change", async () => {
    const ctx = newCtx();
    const p = await createProduct(ctx, make());
    const u = await updateProduct(
      ctx,
      p.id,
      patch({
        variants: [
          { id: "m", size: "M" },
          { id: "l", size: "L" },
        ],
      }),
    );
    expect(u.variants).toHaveLength(2);
    expect((await inventoryOf(ctx, p.id)).map((d) => d.id).sort()).toEqual([
      `${p.id}__l`,
      `${p.id}__m`,
    ]);

    const q = await createProduct(ctx, make());
    await db().collection("inventory").doc(`${q.id}__default`).update({ onHand: 3, available: 3 });
    expect(
      await rejection(updateProduct(ctx, q.id, patch({ variants: [{ size: "M" }] }))),
    ).toBeInstanceOf(ConflictError);
    expect((await inventoryOf(ctx, q.id)).map((d) => d.id)).toEqual([`${q.id}__default`]);
    expect((await getProduct(ctx, q.id)).variants).toEqual([]);
  });

  it("variants -> none: zero-stock variant docs are replaced by the default doc", async () => {
    const ctx = newCtx();
    const p = await createProduct(ctx, make({ variants: [{ id: "m", size: "M" }] }));
    const u = await updateProduct(ctx, p.id, patch({ variants: [] }));
    expect(u.variants).toEqual([]);
    expect((await inventoryOf(ctx, p.id)).map((d) => d.id)).toEqual([`${p.id}__default`]);
  });

  it("keeps an unchanged variant list's inventory (and its stock) untouched", async () => {
    const ctx = newCtx();
    const p = await createProduct(ctx, make({ variants: [{ id: "m", size: "M" }] }));
    await db().collection("inventory").doc(`${p.id}__m`).update({ onHand: 7, available: 7 });
    await updateProduct(ctx, p.id, patch({ variants: [{ id: "m", size: "M", color: "Red" }] }));
    expect((await db().collection("inventory").doc(`${p.id}__m`).get()).get("onHand")).toBe(7);
  });

  it("rejects a foreign category or foreign image on update", async () => {
    const ctx = newCtx();
    const other = newCtx();
    const theirs = await createCategory(other, categoryInputSchema.parse({ name: "X" }));
    const p = await createProduct(ctx, make());
    expect(
      await rejection(updateProduct(ctx, p.id, patch({ categoryId: theirs.id }))),
    ).toBeInstanceOf(ValidationError);
    expect(
      await rejection(updateProduct(ctx, p.id, patch({ images: [image(other.organizationId)] }))),
    ).toBeInstanceOf(ValidationError);
    expect(await getProduct(ctx, p.id)).not.toHaveProperty("categoryId");
  });

  it("another organization's product, or an invalid id, is NotFound", async () => {
    const a = newCtx();
    const b = newCtx();
    const p = await createProduct(a, make());
    expect(await rejection(updateProduct(b, p.id, patch({ name: "Hijack" })))).toBeInstanceOf(
      NotFoundError,
    );
    expect(await rejection(getProduct(b, p.id))).toBeInstanceOf(NotFoundError);
    expect(await rejection(archiveProduct(b, p.id))).toBeInstanceOf(NotFoundError);
    expect(await rejection(updateProduct(a, "a/b", patch({ name: "x" })))).toBeInstanceOf(
      NotFoundError,
    );
    expect(await rejection(getProduct(a, ""))).toBeInstanceOf(NotFoundError);
    expect((await getProduct(a, p.id)).name).toBe(p.name);
  });

  it("writes an audit row with changed field names and values but no free text", async () => {
    const ctx = newCtx();
    const p = await createProduct(ctx, make({ regularPriceMinor: 1000 }));
    await updateProduct(
      ctx,
      p.id,
      patch({
        regularPriceMinor: 2000,
        description: "Secret blurb",
        faqs: [{ q: "Q?", a: "Private answer" }],
      }),
    );
    const log = (await docsOf("auditLogs", ctx.organizationId)).find(
      (d) => d.get("action") === "product.update",
    )!;
    expect(log.data()).toMatchObject({
      resource: "product",
      resourceId: p.id,
      before: { regularPriceMinor: 1000 },
      after: { regularPriceMinor: 2000 },
    });
    expect(log.get("after.changedFields")).toEqual(
      expect.arrayContaining(["regularPriceMinor", "description", "faqs"]),
    );
    const dump = JSON.stringify(log.data());
    expect(dump).not.toContain("Secret blurb");
    expect(dump).not.toContain("Private answer");
  });

  it("persists nothing (SKU move, inventory, product) when the audit write fails", async () => {
    const ctx = newCtx();
    const p = await createProduct(ctx, make({ sku: "keep-1", variants: [{ id: "m", size: "M" }] }));
    const before = await countAll(ctx);
    audit.fail = true;
    await expect(
      updateProduct(
        ctx,
        p.id,
        patch({
          sku: "moved-1",
          name: "Moved",
          variants: [
            { id: "m", size: "M" },
            { id: "l", size: "L" },
          ],
        }),
      ),
    ).rejects.toThrow("audit unavailable");
    audit.fail = false;
    expect(await countAll(ctx)).toEqual(before);
    expect((await skuLock(ctx.organizationId, "KEEP-1").get()).exists).toBe(true);
    expect((await skuLock(ctx.organizationId, "MOVED-1").get()).exists).toBe(false);
    expect(await getProduct(ctx, p.id)).toMatchObject({ sku: "KEEP-1", name: p.name });
    expect((await inventoryOf(ctx, p.id)).map((d) => d.id)).toEqual([`${p.id}__m`]);
  });
});

describe("archiveProduct", () => {
  it("archives, keeps locks and inventory, and is idempotent", async () => {
    const ctx = newCtx();
    const p = await createProduct(ctx, make({ availability: "active" }));
    const a = await archiveProduct(ctx, p.id);
    expect(a).toMatchObject({ id: p.id, archived: true, availability: "archived" });
    expect((await skuLock(ctx.organizationId, p.sku).get()).exists).toBe(true);
    expect((await slugLock(ctx.organizationId, p.slug).get()).exists).toBe(true);
    expect(await inventoryOf(ctx, p.id)).toHaveLength(1);

    const again = await archiveProduct(ctx, p.id);
    expect(again.archived).toBe(true);
    const logs = (await docsOf("auditLogs", ctx.organizationId)).filter(
      (d) => d.get("action") === "product.archive",
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]!.data()).toMatchObject({
      resourceId: p.id,
      before: { availability: "active" },
      after: { availability: "archived" },
    });
    // The SKU stays reserved.
    expect(await rejection(createProduct(ctx, make({ sku: p.sku })))).toBeInstanceOf(ConflictError);
  });

  it("persists nothing when the audit write fails", async () => {
    const ctx = newCtx();
    const p = await createProduct(ctx, make({ availability: "active" }));
    audit.fail = true;
    await expect(archiveProduct(ctx, p.id)).rejects.toThrow("audit unavailable");
    audit.fail = false;
    expect(await getProduct(ctx, p.id)).toMatchObject({ archived: false, availability: "active" });
  });
});

describe("listProducts", () => {
  const list = (ctx: Ctx, q: Partial<Parameters<typeof listProducts>[1]> = {}) =>
    listProducts(ctx, { sort: "createdAt", dir: "desc", ...q });

  it("hides archived products by default and shows only them with archived=true", async () => {
    const ctx = newCtx();
    const keep = await createProduct(ctx, make());
    const gone = await createProduct(ctx, make());
    await archiveProduct(ctx, gone.id);

    expect((await list(ctx)).items.map((p) => p.id)).toEqual([keep.id]);
    expect((await list(ctx, { archived: false })).items.map((p) => p.id)).toEqual([keep.id]);
    expect((await list(ctx, { archived: true })).items.map((p) => p.id)).toEqual([gone.id]);
  });

  it("is scoped to the organization", async () => {
    const a = newCtx();
    const b = newCtx();
    await createProduct(a, make());
    await createProduct(b, make());
    expect((await list(a)).items).toHaveLength(1);
    expect((await list(a)).items[0]!.organizationId).toBe(a.organizationId);
  });

  it("paginates beyond the limit without duplicates or gaps", async () => {
    const ctx = newCtx();
    const ids: string[] = [];
    for (let i = 0; i < 7; i++)
      ids.push((await createProduct(ctx, make({ name: `Page ${String(i).padStart(2, "0")}` }))).id);

    for (const sort of ["createdAt", "name", "updatedAt"] as const) {
      for (const dir of ["asc", "desc"] as const) {
        const seen: string[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
          const page = await list(ctx, { sort, dir, limit: 3, cursor });
          seen.push(...page.items.map((p) => p.id));
          cursor = page.nextCursor ?? undefined;
          pages += 1;
        } while (cursor);
        expect(pages, `${sort} ${dir}`).toBe(3);
        expect(new Set(seen).size).toBe(7);
        expect([...seen].sort()).toEqual([...ids].sort());
      }
    }
    const byName = (await list(ctx, { sort: "name", dir: "asc" })).items.map((p) => p.name);
    expect(byName).toEqual([...byName].sort());
  });

  it("filters by availability or category", async () => {
    const ctx = newCtx();
    const cat = await createCategory(ctx, categoryInputSchema.parse({ name: "Tops" }));
    const a = await createProduct(ctx, make({ availability: "active", categoryId: cat.id }));
    const d = await createProduct(ctx, make({ availability: "draft" }));
    expect((await list(ctx, { availability: "active" })).items.map((p) => p.id)).toEqual([a.id]);
    expect((await list(ctx, { availability: "draft" })).items.map((p) => p.id)).toEqual([d.id]);
    expect((await list(ctx, { categoryId: cat.id })).items.map((p) => p.id)).toEqual([a.id]);
    expect((await list(ctx, { categoryId: "other" })).items).toEqual([]);
  });

  it("rejects two filters, and search combined with a filter or the other search", async () => {
    const ctx = newCtx();
    expect(await rejection(list(ctx, { availability: "active", categoryId: "c" }))).toBeInstanceOf(
      ValidationError,
    );
    expect(await rejection(list(ctx, { q: "a", availability: "active" }))).toBeInstanceOf(
      ValidationError,
    );
    expect(await rejection(list(ctx, { sku: "a", categoryId: "c" }))).toBeInstanceOf(
      ValidationError,
    );
    expect(await rejection(list(ctx, { q: "a", sku: "b" }))).toBeInstanceOf(ValidationError);
  });

  it("searches by name prefix (case-insensitive, Bangla, honours archived) and by SKU prefix", async () => {
    const ctx = newCtx();
    const shirt = await createProduct(ctx, make({ name: "Cotton Shirt", sku: "shirt-100" }));
    const shorts = await createProduct(ctx, make({ name: "Cotton Shorts", sku: "short-200" }));
    const bn = await createProduct(ctx, make({ name: BN_NAME, sku: "bn-1" }));
    const hidden = await createProduct(ctx, make({ name: "Cotton Hidden", sku: "shirt-300" }));
    await archiveProduct(ctx, hidden.id);

    const names = async (q: Parameters<typeof list>[1]) =>
      (await list(ctx, q)).items.map((p) => p.id);
    expect(await names({ q: "COTTON" })).toEqual([shirt.id, shorts.id]);
    expect(await names({ q: "  cotton   sho" })).toEqual([shorts.id]);
    expect(await names({ q: BN_NAME.slice(0, 2) })).toEqual([bn.id]);
    expect(await names({ q: "cotton h" })).toEqual([]);
    expect(await names({ q: "cotton h", archived: true })).toEqual([hidden.id]);
    expect(await names({ q: "zzz" })).toEqual([]);

    expect(await names({ sku: "shirt" })).toEqual([shirt.id]);
    expect(await names({ sku: "SHIRT-1" })).toEqual([shirt.id]);
    expect(await names({ sku: "sh" })).toEqual(
      [shirt.id, shorts.id].sort((x, y) => {
        const sx = x === shirt.id ? "shirt-100" : "short-200";
        const sy = y === shirt.id ? "shirt-100" : "short-200";
        return sx < sy ? -1 : 1;
      }),
    );
    expect(await names({ sku: "shirt", archived: true })).toEqual([hidden.id]);
  });

  it("search results paginate without duplicates", async () => {
    const ctx = newCtx();
    for (let i = 0; i < 5; i++) await createProduct(ctx, make({ name: `Shoe ${i}` }));
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list(ctx, { q: "shoe", limit: 2, cursor });
      seen.push(...page.items.map((p) => p.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(seen).size).toBe(5);
    expect(seen).toHaveLength(5);
  });
});

describe("categories", () => {
  it("creates a category with a lock and an audit row", async () => {
    const ctx = newCtx();
    const c = await createCategory(
      ctx,
      categoryInputSchema.parse({ name: "  Summer   Wear ", description: "Light clothes" }),
    );
    expect(c).toMatchObject({
      name: "Summer   Wear",
      description: "Light clothes",
      organizationId: ctx.organizationId,
    });
    expect(c).not.toHaveProperty("nameLower");
    expect((await db().collection("categories").doc(c.id).get()).get("nameLower")).toBe(
      "summer wear",
    );
    expect(await docsOf("categoryNames", ctx.organizationId)).toHaveLength(1);
    const logs = await docsOf("auditLogs", ctx.organizationId);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.data()).toMatchObject({
      action: "category.create",
      resource: "category",
      resourceId: c.id,
    });
  });

  it("rejects duplicate names ignoring case and spacing; allows them in another organization", async () => {
    const ctx = newCtx();
    const other = newCtx();
    await createCategory(ctx, categoryInputSchema.parse({ name: "Summer Wear" }));
    for (const name of [
      "summer wear",
      "  SUMMER   wear  ",
      `Summer${String.fromCodePoint(0xa0)}Wear`,
    ]) {
      const err = await rejection(createCategory(ctx, categoryInputSchema.parse({ name })));
      expect(err, name).toBeInstanceOf(ConflictError);
      expect((err as Error).message).toBe("A category with this name already exists");
    }
    expect((await docsOf("categories", ctx.organizationId)).length).toBe(1);
    expect(
      await createCategory(other, categoryInputSchema.parse({ name: "Summer Wear" })),
    ).toMatchObject({
      organizationId: other.organizationId,
    });
  });

  it("handles names with slashes and Bangla names", async () => {
    const ctx = newCtx();
    expect((await createCategory(ctx, categoryInputSchema.parse({ name: "T/Shirts" }))).name).toBe(
      "T/Shirts",
    );
    expect((await createCategory(ctx, categoryInputSchema.parse({ name: BN_NAME }))).name).toBe(
      BN_NAME,
    );
    expect(
      await rejection(createCategory(ctx, categoryInputSchema.parse({ name: "t/shirts" }))),
    ).toBeInstanceOf(ConflictError);
  });

  it("10 concurrent creates of one name yield one category", async () => {
    const ctx = newCtx();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        createCategory(ctx, categoryInputSchema.parse({ name: "Racing" })),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await docsOf("categories", ctx.organizationId)).length).toBe(1);
    expect((await docsOf("categoryNames", ctx.organizationId)).length).toBe(1);
    expect((await docsOf("auditLogs", ctx.organizationId)).length).toBe(1);
  });

  it("lists only the organization's categories, sorted by name", async () => {
    const a = newCtx();
    const b = newCtx();
    for (const name of ["Charlie", "alpha", "Bravo"])
      await createCategory(a, categoryInputSchema.parse({ name }));
    await createCategory(b, categoryInputSchema.parse({ name: "Other" }));
    expect((await listCategories(a)).map((c) => c.name)).toEqual(["alpha", "Bravo", "Charlie"]);
    expect((await listCategories(b)).map((c) => c.name)).toEqual(["Other"]);
    expect(await listCategories(newCtx())).toEqual([]);
  });

  it("persists nothing when the audit write fails", async () => {
    const ctx = newCtx();
    audit.fail = true;
    await expect(createCategory(ctx, categoryInputSchema.parse({ name: "Ghost" }))).rejects.toThrow(
      "audit unavailable",
    );
    audit.fail = false;
    expect(await docsOf("categories", ctx.organizationId)).toHaveLength(0);
    expect(await docsOf("categoryNames", ctx.organizationId)).toHaveLength(0);
    // The name is still free.
    expect((await createCategory(ctx, categoryInputSchema.parse({ name: "Ghost" }))).name).toBe(
      "Ghost",
    );
  });
});
