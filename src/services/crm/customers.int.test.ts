import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { customerPatchSchema, customerInputSchema } from "@/schemas/customer";

import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
} from "./customers";

// Failure seam: lets a test make the in-transaction audit write throw, to prove that nothing
// else in the same transaction (customer, phone lock) survives.
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

/** ASCII digits to Bangla digits and Bangla text, built from code points (source stays ASCII). */
const bn = (s: string) => s.replace(/\d/g, (d) => String.fromCodePoint(0x09e6 + Number(d)));
const RAHIM = String.fromCodePoint(0x09b0, 0x09b9, 0x09bf, 0x09ae);
const EMOJI = String.fromCodePoint(0x1f600);

const orgs: string[] = [];
function newCtx() {
  const organizationId = `org-${randomUUID()}`;
  orgs.push(organizationId);
  return { organizationId, uid: `uid-${randomUUID()}` };
}

let counter = 0;
const phone = () => `01712${String(1000000 + ++counter).slice(1)}`; // 01712 + 6 digits

function make(over: Record<string, unknown> = {}) {
  return customerInputSchema.parse({
    fullName: `Customer ${counter + 1}`,
    phone: phone(),
    ...over,
  });
}
const patch = (p: Record<string, unknown>) => customerPatchSchema.parse(p);

const db = () => adminDb();
async function docsOf(collection: string, organizationId: string) {
  return (await db().collection(collection).where("organizationId", "==", organizationId).get())
    .docs;
}
const lockRef = (org: string, e164: string) =>
  db().collection("customerPhones").doc(`${org}_${e164}`);
const listAll = (
  ctx: ReturnType<typeof newCtx>,
  q: Partial<Parameters<typeof listCustomers>[1]> = {},
) => listCustomers(ctx, { sort: "createdAt", dir: "desc", ...q });

beforeEach(() => {
  audit.fail = false;
});

afterAll(async () => {
  for (const org of orgs) {
    for (const col of ["customers", "customerPhones", "auditLogs"]) {
      const docs = await docsOf(col, org);
      await Promise.all(docs.map((d) => d.ref.delete()));
    }
  }
});

describe("createCustomer", () => {
  it("normalizes the phone, stores managed fields and writes one audit entry", async () => {
    const ctx = newCtx();
    const c = await createCustomer(
      ctx,
      make({ fullName: "Md. Rahim", phone: "01712-345678", email: "A@B.com" }),
    );

    expect(c).toMatchObject({
      fullName: "Md. Rahim",
      phone: "01712-345678",
      phoneE164: "+8801712345678",
      email: "a@b.com",
      organizationId: ctx.organizationId,
      totalSpendMinor: 0,
      customerType: "retail",
      segment: "new_lead",
      tags: [],
      consent: { status: "unknown" },
    });
    expect(c.id).toBeTruthy();
    expect(c.lastInteractionAt).toMatch(/^\d{4}-/);
    expect(c.createdAt).toMatch(/^\d{4}-/);
    expect(c).not.toHaveProperty("fullNameLower");

    const raw = (await db().collection("customers").doc(c.id).get()).data()!;
    expect(raw.fullNameLower).toBe("md. rahim");
    expect(raw.lastInteractionAt).toBeDefined();

    const lock = (await lockRef(ctx.organizationId, "+8801712345678").get()).data()!;
    expect(lock).toMatchObject({
      organizationId: ctx.organizationId,
      customerId: c.id,
      phoneE164: "+8801712345678",
    });
    expect(lock.createdAt).toBeDefined();

    const logs = await docsOf("auditLogs", ctx.organizationId);
    expect(logs).toHaveLength(1);
    const log = logs[0]!.data();
    expect(log).toMatchObject({
      action: "customer.create",
      resource: "customer",
      resourceId: c.id,
      actorUid: ctx.uid,
      organizationId: ctx.organizationId,
    });
    expect(log.before).toBeUndefined();
    expect(log.after).toEqual({
      changedFields: expect.arrayContaining([
        "fullName",
        "phone",
        "email",
        "customerType",
        "segment",
        "tags",
        "consent",
      ]),
      segment: "new_lead",
      customerType: "retail",
      tags: [],
      consentStatus: "unknown",
    });
    // No personal data anywhere in the stored row.
    const stored = JSON.stringify(log);
    for (const pii of ["Md. Rahim", "md. rahim", "a@b.com", "1712345678", "712-345678", "01712"]) {
      expect(stored, pii).not.toContain(pii);
    }
  });

  it("uses a server-generated id, never a client-chosen one", async () => {
    const ctx = newCtx();
    const c = await createCustomer(ctx, { ...make(), id: "chosen-by-client" } as never);
    expect(c.id).not.toBe("chosen-by-client");
    expect((await db().collection("customers").doc("chosen-by-client").get()).exists).toBe(false);
  });

  it("sets consent.at to the server time for granted/denied when missing, keeps an explicit one", async () => {
    const ctx = newCtx();
    const granted = await createCustomer(
      ctx,
      make({ consent: { status: "granted", source: "form" } }),
    );
    const denied = await createCustomer(ctx, make({ consent: { status: "denied" } }));
    const unknown = await createCustomer(ctx, make());
    const explicit = await createCustomer(
      ctx,
      make({ consent: { status: "granted", source: "form", at: "2024-01-02T03:04:05.000Z" } }),
    );
    expect(Date.parse(granted.consent.at!)).toBeGreaterThan(Date.now() - 60_000);
    expect(typeof granted.consent.at).toBe("string");
    expect(denied.consent.at).toBeDefined();
    expect(unknown.consent.at).toBeUndefined();
    expect(explicit.consent.at).toBe("2024-01-02T03:04:05.000Z");
  });

  it("stores an explicit consent.at as UTC and rejects one in the future", async () => {
    const ctx = newCtx();
    const offset = await createCustomer(
      ctx,
      make({ consent: { status: "granted", source: "form", at: "2024-01-02T09:04:05+06:00" } }),
    );
    expect(offset.consent.at).toBe("2024-01-02T03:04:05.000Z");

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await expect(
      createCustomer(
        ctx,
        make({ phone: "01712000999", consent: { status: "granted", source: "form", at: future } }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("does not persist extra client props or client-supplied managed/derived fields", async () => {
    const ctx = newCtx();
    const evil = {
      ...make({ phone: "01712000111" }),
      totalSpendMinor: 999,
      lastInteractionAt: "2000-01-01T00:00:00.000Z",
      organizationId: "evil-org",
      fullNameLower: "evil",
      phoneE164: "+8801999999999",
      isAdmin: true,
      tagsLower: ["evil"],
      createdAt: "2000-01-01T00:00:00.000Z",
    };
    const c = await createCustomer(ctx, evil as never);
    const raw = (await db().collection("customers").doc(c.id).get()).data()!;
    expect(raw.totalSpendMinor).toBe(0);
    expect(raw.organizationId).toBe(ctx.organizationId);
    expect(raw.phoneE164).toBe("+8801712000111");
    expect(raw.fullNameLower).not.toBe("evil");
    expect(raw).not.toHaveProperty("isAdmin");
    expect(raw.tagsLower).toEqual([]);
    expect(c.createdAt.startsWith("2000")).toBe(false);
    expect(c.lastInteractionAt!.startsWith("2000")).toBe(false);
    expect((await lockRef(ctx.organizationId, "+8801999999999").get()).exists).toBe(false);
  });

  it("rejects an input whose phone cannot be normalized (no writes)", async () => {
    const ctx = newCtx();
    await expect(createCustomer(ctx, { ...make(), phone: "12" } as never)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await docsOf("customers", ctx.organizationId)).toHaveLength(0);
  });
});

describe("phone uniqueness", () => {
  it("rejects the same number in a different format (local / +880 / Bangla digits) with exactly one lock", async () => {
    const ctx = newCtx();
    await createCustomer(ctx, make({ phone: "01712-345678" }));
    for (const dup of ["+8801712345678", bn("01712345678"), "8801712 345 678", "0171 2345678"]) {
      const err = await createCustomer(ctx, make({ phone: dup })).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictError);
    }
    expect(await docsOf("customers", ctx.organizationId)).toHaveLength(1);
    expect(await docsOf("customerPhones", ctx.organizationId)).toHaveLength(1);
    expect(await docsOf("auditLogs", ctx.organizationId)).toHaveLength(1);
  });

  it("the conflict message reveals nothing about the other customer", async () => {
    const ctx = newCtx();
    const first = await createCustomer(
      ctx,
      make({ fullName: "Secret Person", phone: "01712345679" }),
    );
    const err = (await createCustomer(ctx, make({ phone: "01712345679" })).catch(
      (e: unknown) => e,
    )) as ConflictError;
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toBe("A customer with this phone number already exists");
    expect(err.message).not.toContain(first.id);
    expect(JSON.stringify(err)).not.toContain("Secret");
  });

  it("allows the same number in a different organization", async () => {
    const a = newCtx();
    const b = newCtx();
    const p = "01712999888";
    await createCustomer(a, make({ phone: p }));
    await expect(createCustomer(b, make({ phone: p }))).resolves.toBeDefined();
    expect(await docsOf("customerPhones", a.organizationId)).toHaveLength(1);
    expect(await docsOf("customerPhones", b.organizationId)).toHaveLength(1);
  });

  it("10 concurrent creates of one phone: exactly one succeeds, nine ConflictError, one doc, one lock", async () => {
    const ctx = newCtx();
    const p = "01712555000";
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        createCustomer(ctx, make({ fullName: `Racer ${i}`, phone: p })),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(9);
    for (const f of failed) expect(f.reason).toBeInstanceOf(ConflictError);
    expect(await docsOf("customers", ctx.organizationId)).toHaveLength(1);
    expect(await docsOf("customerPhones", ctx.organizationId)).toHaveLength(1);
    expect(await docsOf("auditLogs", ctx.organizationId)).toHaveLength(1);
  });
});

describe("updateCustomer", () => {
  it("changing the phone moves the lock: old number reusable, new number taken", async () => {
    const ctx = newCtx();
    const c = await createCustomer(ctx, make({ phone: "01712000001" }));
    const updated = await updateCustomer(ctx, c.id, patch({ phone: "01712000002" }));
    expect(updated.phoneE164).toBe("+8801712000002");
    expect((await lockRef(ctx.organizationId, "+8801712000001").get()).exists).toBe(false);
    const lock = (await lockRef(ctx.organizationId, "+8801712000002").get()).data()!;
    expect(lock.customerId).toBe(c.id);
    expect(await docsOf("customerPhones", ctx.organizationId)).toHaveLength(1);

    await expect(createCustomer(ctx, make({ phone: "01712000002" }))).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(createCustomer(ctx, make({ phone: "01712000001" }))).resolves.toBeDefined();
  });

  it("re-formatting the same number changes only the display copy and keeps the lock", async () => {
    const ctx = newCtx();
    const c = await createCustomer(ctx, make({ phone: "01712000003" }));
    const updated = await updateCustomer(ctx, c.id, patch({ phone: "+880 1712-000003" }));
    expect(updated.phone).toBe("+880 1712-000003");
    expect(updated.phoneE164).toBe("+8801712000003");
    expect(await docsOf("customerPhones", ctx.organizationId)).toHaveLength(1);
  });

  it("a phone owned by another customer is a ConflictError and nothing changes", async () => {
    const ctx = newCtx();
    const a = await createCustomer(ctx, make({ fullName: "A", phone: "01712000011" }));
    const b = await createCustomer(ctx, make({ fullName: "B", phone: "01712000012" }));
    const err = await updateCustomer(
      ctx,
      a.id,
      patch({ phone: "01712000012", fullName: "A renamed" }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);

    const rawA = (await db().collection("customers").doc(a.id).get()).data()!;
    expect(rawA.fullName).toBe("A");
    expect(rawA.phoneE164).toBe("+8801712000011");
    expect((await lockRef(ctx.organizationId, "+8801712000011").get()).data()!.customerId).toBe(
      a.id,
    );
    expect((await lockRef(ctx.organizationId, "+8801712000012").get()).data()!.customerId).toBe(
      b.id,
    );
    expect(await docsOf("customerPhones", ctx.organizationId)).toHaveLength(2);
    expect(await docsOf("auditLogs", ctx.organizationId)).toHaveLength(2); // two creates only
  });

  it("two customers racing for one new phone: exactly one wins", async () => {
    const ctx = newCtx();
    const a = await createCustomer(ctx, make({ phone: "01712000021" }));
    const b = await createCustomer(ctx, make({ phone: "01712000022" }));
    const results = await Promise.allSettled([
      updateCustomer(ctx, a.id, patch({ phone: "01712000023" })),
      updateCustomer(ctx, b.id, patch({ phone: "01712000023" })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
    expect(lost.reason).toBeInstanceOf(ConflictError);

    // The winner moved to the contested number; the loser still holds its original one.
    const winnerIsA = results[0]!.status === "fulfilled";
    const expected = new Map<string, string>([
      [winnerIsA ? a.id : b.id, "+8801712000023"],
      [winnerIsA ? b.id : a.id, winnerIsA ? "+8801712000022" : "+8801712000021"],
    ]);
    const locks = await docsOf("customerPhones", ctx.organizationId);
    expect(locks).toHaveLength(2);
    expect(
      new Map(locks.map((l) => [l.data().customerId as string, l.data().phoneE164 as string])),
    ).toEqual(expected);
  });

  it("PATCH null clears email/whatsapp (incl. whatsappE164)/address/leadSource, keeps consent, tags and segment", async () => {
    const ctx = newCtx();
    const c = await createCustomer(
      ctx,
      make({
        email: "x@y.com",
        whatsappNumber: "01812345678",
        address: "Dhaka",
        leadSource: "facebook",
        tags: ["vip"],
        segment: "converted",
        consent: { status: "granted", source: "form" },
      }),
    );
    expect(c.whatsappE164).toBe("+8801812345678");

    const updated = await updateCustomer(
      ctx,
      c.id,
      patch({ email: null, whatsappNumber: null, address: null, leadSource: null }),
    );
    for (const k of ["email", "whatsappNumber", "whatsappE164", "address", "leadSource"]) {
      expect(updated).not.toHaveProperty(k);
    }
    expect(updated.tags).toEqual(["vip"]);
    expect(updated.segment).toBe("converted");
    expect(updated.consent).toMatchObject({ status: "granted", source: "form" });

    const raw = (await db().collection("customers").doc(c.id).get()).data()!;
    for (const k of ["email", "whatsappNumber", "whatsappE164", "address", "leadSource"]) {
      expect(Object.hasOwn(raw, k), k).toBe(false);
    }
  });

  it("renaming refreshes fullNameLower and updatedAt, and leaves managed fields alone", async () => {
    const ctx = newCtx();
    const c = await createCustomer(ctx, make({ fullName: "Old Name" }));
    const u = await updateCustomer(ctx, c.id, patch({ fullName: "New NAME" }));
    expect(u.fullName).toBe("New NAME");
    const raw = (await db().collection("customers").doc(c.id).get()).data()!;
    expect(raw.fullNameLower).toBe("new name");
    expect(u.createdAt).toBe(c.createdAt);
    expect(Date.parse(u.updatedAt)).toBeGreaterThanOrEqual(Date.parse(c.updatedAt));
    expect(u.totalSpendMinor).toBe(0);
    expect(u.lastInteractionAt).toBe(c.lastInteractionAt);
  });

  it("a patch cannot touch managed fields even if smuggled in", async () => {
    const ctx = newCtx();
    const c = await createCustomer(ctx, make());
    const u = await updateCustomer(ctx, c.id, {
      ...patch({ segment: "inactive" }),
      organizationId: "evil",
      totalSpendMinor: 5,
      fullNameLower: "evil",
      id: "other",
    } as never);
    expect(u.organizationId).toBe(ctx.organizationId);
    expect(u.totalSpendMinor).toBe(0);
    expect(u.id).toBe(c.id);
    expect((await db().collection("customers").doc(c.id).get()).data()!.fullNameLower).toBe(
      c.fullName.toLowerCase(),
    );
  });

  it("writes an audit entry holding only the changed fields (before/after)", async () => {
    const ctx = newCtx();
    const c = await createCustomer(
      ctx,
      make({ fullName: "Aud", segment: "interested", tags: ["a"] }),
    );
    await updateCustomer(
      ctx,
      c.id,
      patch({
        segment: "converted",
        tags: ["a"],
        address: "Dhaka",
        fullName: "Aud Renamed",
        email: "p@q.com",
      }),
    );
    const logs = (await docsOf("auditLogs", ctx.organizationId))
      .map((d) => d.data())
      .filter((l) => l.action === "customer.update");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ resource: "customer", resourceId: c.id, actorUid: ctx.uid });
    expect(logs[0]!.before).toEqual({ segment: "interested" });
    expect(logs[0]!.after).toEqual({
      changedFields: ["fullName", "email", "address", "segment"],
      segment: "converted",
    });
    const stored = JSON.stringify(logs[0]);
    for (const pii of ["Aud", "p@q.com", "Dhaka"]) expect(stored, pii).not.toContain(pii);
  });

  it("NotFound for a missing id, an invalid id, and another organization's customer (nothing changes)", async () => {
    const a = newCtx();
    const b = newCtx();
    const c = await createCustomer(a, make({ fullName: "Mine" }));
    await expect(updateCustomer(b, c.id, patch({ fullName: "Hacked" }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      updateCustomer(a, "does-not-exist", patch({ fullName: "x" })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateCustomer(a, "a/b", patch({ fullName: "x" }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await db().collection("customers").doc(c.id).get()).data()!.fullName).toBe("Mine");
  });

  it("another organization cannot move a phone lock through update", async () => {
    const a = newCtx();
    const b = newCtx();
    const c = await createCustomer(a, make({ phone: "01712000031" }));
    await expect(updateCustomer(b, c.id, patch({ phone: "01712000032" }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await lockRef(a.organizationId, "+8801712000031").get()).exists).toBe(true);
    expect((await lockRef(b.organizationId, "+8801712000032").get()).exists).toBe(false);
  });
});

describe("missing locks and corrupt rows", () => {
  it("update with the old lock missing still succeeds and creates the new lock", async () => {
    const ctx = newCtx();
    const c = await createCustomer(ctx, make({ phone: "01712000061" }));
    await lockRef(ctx.organizationId, "+8801712000061").delete();
    const u = await updateCustomer(ctx, c.id, patch({ phone: "01712000062" }));
    expect(u.phoneE164).toBe("+8801712000062");
    const locks = await docsOf("customerPhones", ctx.organizationId);
    expect(locks.map((l) => l.id)).toEqual([`${ctx.organizationId}_+8801712000062`]);
    expect(locks[0]!.data().customerId).toBe(c.id);
  });

  it("delete with the lock missing still deletes the customer", async () => {
    const ctx = newCtx();
    const c = await createCustomer(ctx, make({ phone: "01712000063" }));
    await lockRef(ctx.organizationId, "+8801712000063").delete();
    await expect(deleteCustomer(ctx, c.id)).resolves.toBeUndefined();
    expect((await db().collection("customers").doc(c.id).get()).exists).toBe(false);
  });

  it("delete leaves a lock that belongs to someone else alone", async () => {
    const ctx = newCtx();
    const c = await createCustomer(ctx, make({ phone: "01712000064" }));
    await lockRef(ctx.organizationId, "+8801712000064").update({ customerId: "someone-else" });
    await deleteCustomer(ctx, c.id);
    expect((await lockRef(ctx.organizationId, "+8801712000064").get()).exists).toBe(true);
  });

  it.each([
    ["a malformed phoneE164", { phoneE164: "not-a-phone" }],
    ["a missing phoneE164", {}],
    ["a non-string phoneE164", { phoneE164: 12345 }],
  ])("a corrupt row with %s can still be deleted and updated", async (_label, extra) => {
    const ctx = newCtx();
    for (const op of ["delete", "update"] as const) {
      const ref = db().collection("customers").doc();
      await ref.set({
        organizationId: ctx.organizationId,
        fullName: "Corrupt",
        segment: "new_lead",
        customerType: "retail",
        ...extra,
      });
      if (op === "delete") {
        await deleteCustomer(ctx, ref.id);
        expect((await ref.get()).exists).toBe(false);
      } else {
        await updateCustomer(ctx, ref.id, patch({ phone: "01712000065" }));
        expect((await ref.get()).data()!.phoneE164).toBe("+8801712000065");
      }
    }
  });
});

describe("deleteCustomer", () => {
  it("removes the customer and frees the phone, with an audit entry holding the before snapshot", async () => {
    const ctx = newCtx();
    const c = await createCustomer(ctx, make({ fullName: "Gone", phone: "01712000041" }));
    await deleteCustomer(ctx, c.id);
    expect((await db().collection("customers").doc(c.id).get()).exists).toBe(false);
    expect(await docsOf("customerPhones", ctx.organizationId)).toHaveLength(0);
    await expect(createCustomer(ctx, make({ phone: "01712000041" }))).resolves.toBeDefined();

    const del = (await docsOf("auditLogs", ctx.organizationId))
      .map((d) => d.data())
      .find((l) => l.action === "customer.delete")!;
    expect(del).toMatchObject({ resource: "customer", resourceId: c.id, actorUid: ctx.uid });
    expect(del.before).toEqual({ segment: "new_lead", customerType: "retail" });
    expect(del.after).toBeUndefined();
    const stored = JSON.stringify(del);
    for (const pii of ["Gone", "gone", "1712000041", "01712"])
      expect(stored, pii).not.toContain(pii);
  });

  it("NotFound for another organization's customer, a missing one and an invalid id; nothing is removed", async () => {
    const a = newCtx();
    const b = newCtx();
    const c = await createCustomer(a, make({ phone: "01712000042" }));
    await expect(deleteCustomer(b, c.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteCustomer(a, "nope")).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteCustomer(a, "a/b")).rejects.toBeInstanceOf(NotFoundError);
    expect((await db().collection("customers").doc(c.id).get()).exists).toBe(true);
    expect((await lockRef(a.organizationId, "+8801712000042").get()).exists).toBe(true);
  });
});

describe("failure atomicity (audit write fails inside the transaction)", () => {
  it("create: neither the customer nor the lock persists, and the phone stays usable", async () => {
    const ctx = newCtx();
    audit.fail = true;
    await expect(createCustomer(ctx, make({ phone: "01712000051" }))).rejects.toThrow(
      "audit unavailable",
    );
    expect(await docsOf("customers", ctx.organizationId)).toHaveLength(0);
    expect(await docsOf("customerPhones", ctx.organizationId)).toHaveLength(0);
    audit.fail = false;
    await expect(createCustomer(ctx, make({ phone: "01712000051" }))).resolves.toBeDefined();
  });

  it("update with a phone change: customer, old lock and new lock are all unchanged", async () => {
    const ctx = newCtx();
    const c = await createCustomer(ctx, make({ fullName: "Keep", phone: "01712000052" }));
    audit.fail = true;
    await expect(
      updateCustomer(ctx, c.id, patch({ fullName: "Changed", phone: "01712000053" })),
    ).rejects.toThrow("audit unavailable");
    const raw = (await db().collection("customers").doc(c.id).get()).data()!;
    expect(raw.fullName).toBe("Keep");
    expect(raw.phoneE164).toBe("+8801712000052");
    expect((await lockRef(ctx.organizationId, "+8801712000052").get()).exists).toBe(true);
    expect((await lockRef(ctx.organizationId, "+8801712000053").get()).exists).toBe(false);
  });

  it("delete: the customer and its lock both survive", async () => {
    const ctx = newCtx();
    const c = await createCustomer(ctx, make({ phone: "01712000054" }));
    audit.fail = true;
    await expect(deleteCustomer(ctx, c.id)).rejects.toThrow("audit unavailable");
    expect((await db().collection("customers").doc(c.id).get()).exists).toBe(true);
    expect((await lockRef(ctx.organizationId, "+8801712000054").get()).exists).toBe(true);
  });
});

describe("getCustomer", () => {
  it("returns the customer for its organization and NotFound otherwise", async () => {
    const a = newCtx();
    const b = newCtx();
    const c = await createCustomer(a, make({ fullName: "Visible" }));
    expect((await getCustomer(a, c.id)).fullName).toBe("Visible");
    await expect(getCustomer(b, c.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getCustomer(a, "missing")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getCustomer(a, "a/b")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getCustomer(a, "__bad__")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("tags (case-insensitive tagsLower)", () => {
  const FULLWIDTH_VIP = String.fromCodePoint(0xff36, 0xff29, 0xff30);
  const BANGLA_TAG = String.fromCodePoint(0x09ac, 0x09bf, 0x09b6, 0x09c7, 0x09b7);

  it("stores a de-duplicated lower-cased key next to the tags as entered, and never exposes it", async () => {
    const ctx = newCtx();
    const c = await createCustomer(ctx, make({ tags: ["VIP", "Dhaka", "vip"] }));
    expect(c.tags).toEqual(["VIP", "Dhaka"]);
    expect(c).not.toHaveProperty("tagsLower");
    expect((await db().collection("customers").doc(c.id).get()).data()!.tagsLower).toEqual([
      "vip",
      "dhaka",
    ]);
  });

  it("the tag filter is case-insensitive and ignores padding", async () => {
    const ctx = newCtx();
    const a = await createCustomer(ctx, make({ tags: ["VIP"] }));
    const b = await createCustomer(ctx, make({ tags: ["vip", "Other"] }));
    await createCustomer(ctx, make({ tags: ["nope"] }));
    for (const tag of ["vip", "VIP", " Vip ", "vip  "]) {
      const ids = (await listAll(ctx, { tag })).items.map((x) => x.id).sort();
      expect(ids, tag).toEqual([a.id, b.id].sort());
    }
    expect((await listAll(ctx, { tag: "missing" })).items).toEqual([]);
    await expect(listAll(ctx, { tag: "   " })).rejects.toBeInstanceOf(ValidationError);
  });

  it("a PATCH that changes tags refreshes tagsLower; a patch that does not touch tags leaves it alone", async () => {
    const ctx = newCtx();
    const c = await createCustomer(ctx, make({ tags: ["Old"] }));
    await updateCustomer(ctx, c.id, patch({ tags: ["New", "VIP"] }));
    const raw = async () => (await db().collection("customers").doc(c.id).get()).data()!;
    expect((await raw()).tagsLower).toEqual(["new", "vip"]);
    expect((await listAll(ctx, { tag: "old" })).items).toEqual([]);
    expect((await listAll(ctx, { tag: "vip" })).items.map((x) => x.id)).toEqual([c.id]);

    await updateCustomer(ctx, c.id, patch({ fullName: "Renamed" }));
    expect((await raw()).tagsLower).toEqual(["new", "vip"]);
    await updateCustomer(ctx, c.id, patch({ tags: [] }));
    expect((await raw()).tagsLower).toEqual([]);
  });

  it("unicode tags: full-width letters fold (NFKC) and Bangla tags match", async () => {
    const ctx = newCtx();
    const c = await createCustomer(ctx, make({ tags: [FULLWIDTH_VIP, BANGLA_TAG] }));
    expect((await listAll(ctx, { tag: "vip" })).items.map((x) => x.id)).toEqual([c.id]);
    expect((await listAll(ctx, { tag: FULLWIDTH_VIP })).items.map((x) => x.id)).toEqual([c.id]);
    expect((await listAll(ctx, { tag: BANGLA_TAG })).items.map((x) => x.id)).toEqual([c.id]);
  });

  it("is org-scoped", async () => {
    const a = newCtx();
    const b = newCtx();
    await createCustomer(b, make({ tags: ["shared"] }));
    expect((await listAll(a, { tag: "shared" })).items).toEqual([]);
  });
});

describe("listCustomers: search", () => {
  it("finds by Bangla name prefix, Latin names case-insensitively, and by phone prefix; never across organizations", async () => {
    const ctx = newCtx();
    const other = newCtx();
    const bangla = await createCustomer(
      ctx,
      make({ fullName: `${RAHIM} Uddin`, phone: "01712100001" }),
    );
    const alice = await createCustomer(
      ctx,
      make({ fullName: "Alice Cooper", phone: "01912100002" }),
    );
    const alina = await createCustomer(ctx, make({ fullName: "ALINA Khan", phone: "01912100003" }));
    await createCustomer(ctx, make({ fullName: "Bob", phone: "01812100004" }));
    await createCustomer(other, make({ fullName: "Alice Foreign", phone: "01912100002" }));

    const names = async (search: string) => (await listAll(ctx, { search })).items.map((c) => c.id);

    expect(await names(RAHIM)).toEqual([bangla.id]);
    expect(await names("alI")).toEqual([alice.id, alina.id]);
    expect(await names("ALICE")).toEqual([alice.id]);
    expect(await names("  alice co  ")).toEqual([alice.id]);
    expect(await names("zzz")).toEqual([]);

    const byPhone = await listAll(ctx, { search: "0191" });
    expect(byPhone.items.map((c) => c.id).sort()).toEqual([alice.id, alina.id].sort());
    expect((await listAll(ctx, { search: "+88017121" })).items.map((c) => c.id)).toEqual([
      bangla.id,
    ]);
    expect((await listAll(ctx, { search: bn("01712100") })).items.map((c) => c.id)).toEqual([
      bangla.id,
    ]);
    expect((await listAll(ctx, { search: "01912-100" })).items).toHaveLength(2);
  });

  it("a name whose next character is above U+F8FF (emoji) is still found by its prefix", async () => {
    const ctx = newCtx();
    const c = await createCustomer(ctx, make({ fullName: `Zed${EMOJI}` }));
    expect((await listAll(ctx, { search: "zed" })).items.map((x) => x.id)).toEqual([c.id]);
  });

  it("search ignores sort/dir and is ordered by the searched field ascending; paginates without gaps", async () => {
    const ctx = newCtx();
    for (const n of ["Sam E", "Sam B", "Sam D", "Sam A", "Sam C"])
      await createCustomer(ctx, make({ fullName: n }));
    const first = await listAll(ctx, {
      search: "sam",
      sort: "lastInteractionAt",
      dir: "desc",
      limit: 2,
    });
    expect(first.items.map((c) => c.fullName)).toEqual(["Sam A", "Sam B"]);
    const second = await listAll(ctx, { search: "sam", limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((c) => c.fullName)).toEqual(["Sam C", "Sam D"]);
    const third = await listAll(ctx, { search: "sam", limit: 2, cursor: second.nextCursor! });
    expect(third.items.map((c) => c.fullName)).toEqual(["Sam E"]);
    expect(third.nextCursor).toBeNull();
  });

  it("validates search: too long, combined with a filter", async () => {
    const ctx = newCtx();
    await expect(listAll(ctx, { search: "a".repeat(65) })).rejects.toBeInstanceOf(ValidationError);
    await expect(listAll(ctx, { search: "jo", segment: "converted" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("listCustomers: filters, sorting, pagination", () => {
  it("filters by segment, tag, customer type and agent; two filters are rejected", async () => {
    const ctx = newCtx();
    const a = await createCustomer(
      ctx,
      make({
        segment: "converted",
        tags: ["vip", "dhaka"],
        customerType: "wholesale",
        assignedAgentId: "agent-1",
      }),
    );
    const b = await createCustomer(ctx, make({ segment: "inactive", tags: ["dhaka"] }));
    await createCustomer(newCtx(), make({ segment: "converted", tags: ["vip"] }));

    expect((await listAll(ctx, { segment: "converted" })).items.map((c) => c.id)).toEqual([a.id]);
    expect((await listAll(ctx, { tag: "vip" })).items.map((c) => c.id)).toEqual([a.id]);
    expect((await listAll(ctx, { tag: "dhaka" })).items.map((c) => c.id).sort()).toEqual(
      [a.id, b.id].sort(),
    );
    expect((await listAll(ctx, { customerType: "wholesale" })).items.map((c) => c.id)).toEqual([
      a.id,
    ]);
    expect((await listAll(ctx, { assignedAgentId: "agent-1" })).items.map((c) => c.id)).toEqual([
      a.id,
    ]);
    expect((await listAll(ctx, {})).items).toHaveLength(2);

    const err = await listAll(ctx, { segment: "converted", tag: "vip" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toBe("Use only one filter at a time");
  });

  it("an empty organization lists nothing", async () => {
    expect(await listAll(newCtx())).toEqual({ items: [], nextCursor: null });
  });

  it.each([
    ["fullName", "asc"],
    ["fullName", "desc"],
    ["createdAt", "asc"],
    ["createdAt", "desc"],
    ["lastInteractionAt", "asc"],
    ["lastInteractionAt", "desc"],
  ] as const)(
    "pages through > limit docs sorted by %s %s with no duplicates or gaps",
    async (sort, dir) => {
      const ctx = newCtx();
      const created: string[] = [];
      for (const n of ["Echo", "alpha", "Delta", "charlie", "Bravo", "foxtrot", "Golf"]) {
        created.push((await createCustomer(ctx, make({ fullName: `${n} ${sort}` }))).id);
      }
      const seen: Array<{
        id: string;
        fullName: string;
        createdAt: string;
        lastInteractionAt: string | null;
      }> = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await listCustomers(ctx, { sort, dir, limit: 3, cursor });
        seen.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        pages++;
      } while (cursor && pages < 10);

      expect(pages).toBe(3);
      expect(seen.map((c) => c.id).sort()).toEqual([...created].sort());
      expect(new Set(seen.map((c) => c.id)).size).toBe(7);

      const key = (c: (typeof seen)[number]) =>
        sort === "fullName"
          ? c.fullName.toLowerCase()
          : sort === "createdAt"
            ? c.createdAt
            : (c.lastInteractionAt ?? "");
      const keys = seen.map(key);
      const sorted = [...keys].sort();
      expect(keys).toEqual(dir === "asc" ? sorted : sorted.reverse());
    },
  );

  it("limit: default 25 and the maximum is enforced", async () => {
    const ctx = newCtx();
    await expect(listAll(ctx, { limit: 51 })).rejects.toBeInstanceOf(ValidationError);
    await expect(listAll(ctx, { limit: 0 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("a malformed cursor is a ValidationError", async () => {
    const ctx = newCtx();
    await expect(listAll(ctx, { cursor: "not-a-cursor!" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listAll(ctx, { cursor: "e30" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("a forged cursor cannot reach another organization's data", async () => {
    const a = newCtx();
    const b = newCtx();
    await createCustomer(a, make({ fullName: "Mine" }));
    await createCustomer(b, make({ fullName: "Theirs" }));
    const cursor = Buffer.from(JSON.stringify({ t: "s", v: "", id: "zzz" })).toString("base64url");
    const page = await listCustomers(a, { sort: "fullName", dir: "asc", cursor });
    expect(page.items.every((c) => c.organizationId === a.organizationId)).toBe(true);
    expect(page.items.map((c) => c.fullName)).not.toContain("Theirs");
  });
});
