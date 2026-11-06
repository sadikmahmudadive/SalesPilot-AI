import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

import { Transaction } from "firebase-admin/firestore";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import {
  ConflictError,
  InsufficientStockError,
  InventoryBusyError,
  NotFoundError,
  ValidationError,
  isAppError,
} from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";

import { productInputSchema, productPatchSchema } from "@/schemas/product";
import { createProduct, updateProduct } from "@/services/products/products";

import {
  ADJUST_MAX_ATTEMPTS,
  RESERVATION_MAX_ATTEMPTS,
  adjustStock,
  commitStock,
  releaseStock,
  reserveStock,
} from "./stock";

// Failure seam: lets a test make the in-transaction audit write throw, to prove that the
// counters written in the same transaction do not survive.
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

/** Re-runs of the 30-way contention test (the implementer's flake check uses 5). */
const REPEAT = Math.max(1, Number(process.env.STOCK_CONCURRENCY_REPEAT ?? 1));

const orgs: string[] = [];
const newOrg = () => {
  const id = `org-${randomUUID()}`;
  orgs.push(id);
  return id;
};
const db = () => adminDb();

interface Unit {
  org: string;
  productId: string;
  variantId: string;
  id: string;
}

async function seed(
  org: string,
  counts: { onHand: number; reserved?: number; available?: number },
  opts: { variantId?: string } = {},
): Promise<Unit> {
  const productId = `prod-${randomUUID()}`;
  const variantId = opts.variantId ?? "default";
  const reserved = counts.reserved ?? 0;
  const id = `${productId}__${variantId}`;
  await db()
    .collection("inventory")
    .doc(id)
    .set({
      organizationId: org,
      productId,
      variantId,
      onHand: counts.onHand,
      reserved,
      available: counts.available ?? counts.onHand - reserved,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  return { org, productId, variantId, id };
}

const invDoc = (u: Unit) => db().collection("inventory").doc(u.id);
const resDoc = (u: Unit, key: string) => invDoc(u).collection("reservations").doc(key);

async function reservationsOf(u: Unit) {
  return (await invDoc(u).collection("reservations").get()).docs.map((d) => ({
    key: d.id,
    ...(d.data() as { quantity: number; status: string; organizationId: string }),
  }));
}

/** Reads the counters and asserts the invariants that must hold after EVERY scenario. */
async function state(u: Unit) {
  const d = (await invDoc(u).get()).data()!;
  const { onHand, reserved, available } = d as {
    onHand: number;
    reserved: number;
    available: number;
  };
  for (const n of [onHand, reserved, available]) {
    expect(Number.isSafeInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
  }
  expect(available).toBe(onHand - reserved);
  const reservations = await reservationsOf(u);
  const sumReserved = reservations
    .filter((r) => r.status === "reserved")
    .reduce((a, r) => a + r.quantity, 0);
  expect(reserved).toBe(sumReserved);
  return { onHand, reserved, available, reservations };
}

const reserve = (u: Unit, q: number, key: string) =>
  reserveStock(u.org, u.productId, u.variantId, q, key);
const release = (u: Unit, key: string) => releaseStock(u.org, u.productId, u.variantId, key);
const commit = (u: Unit, key: string) => commitStock(u.org, u.productId, u.variantId, key);
const adjust = (u: Unit, delta: number, reason = "Stock count", uid = "uid-1") =>
  adjustStock({ organizationId: u.org, uid }, u.productId, u.variantId, { delta, reason });

const rejection = async (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );
const isInternal = (e: unknown) => e instanceof Error && !isAppError(e);

beforeEach(() => {
  audit.fail = false;
});

afterAll(async () => {
  for (const org of orgs) {
    for (const col of ["inventory", "auditLogs"]) {
      const snap = await db().collection(col).where("organizationId", "==", org).get();
      await Promise.all(snap.docs.map((d) => db().recursiveDelete(d.ref)));
    }
  }
}, 60_000);

describe("reserveStock", () => {
  it("reserves, then refuses an oversell without writing", async () => {
    const u = await seed(newOrg(), { onHand: 5 });
    expect(await reserve(u, 3, "k1")).toEqual({
      reservationId: "k1",
      available: 2,
      status: "reserved",
    });
    const err = await rejection(reserve(u, 3, "k2"));
    expect(err).toBeInstanceOf(InsufficientStockError);
    const s = await state(u);
    expect(s).toMatchObject({ onHand: 5, reserved: 3, available: 2 });
    expect(s.reservations.map((r) => r.key)).toEqual(["k1"]);
    expect(s.reservations[0]).toMatchObject({
      quantity: 3,
      status: "reserved",
      organizationId: u.org,
    });
  });

  it("can reserve exactly the available quantity, and nothing more", async () => {
    const u = await seed(newOrg(), { onHand: 4 });
    await reserve(u, 4, "all");
    expect(await rejection(reserve(u, 1, "more"))).toBeInstanceOf(InsufficientStockError);
    expect(await state(u)).toMatchObject({ onHand: 4, reserved: 4, available: 0 });
  });

  it(
    "30 concurrent reserves of 1 against stock 10: exactly 10 succeed, 20 are insufficient",
    async () => {
      for (let round = 0; round < REPEAT; round++) {
        const startedAt = Date.now();
        const u = await seed(newOrg(), { onHand: 10 });
        const results = await Promise.allSettled(
          Array.from({ length: 30 }, (_, i) => reserve(u, 1, `k${i}`)),
        );
        const ok = results.filter((r) => r.status === "fulfilled");
        const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
        expect(ok).toHaveLength(10);
        expect(failed).toHaveLength(20);
        for (const f of failed) expect(f.reason).toBeInstanceOf(InsufficientStockError);
        const s = await state(u);
        expect(s).toMatchObject({ onHand: 10, reserved: 10, available: 0 });
        expect(s.reservations).toHaveLength(10);
        if (REPEAT > 1)
          process.stderr.write(`30-way round ${round + 1}/${REPEAT}: ${Date.now() - startedAt}ms
`);
      }
    },
    90_000 * REPEAT,
  );

  it("20 concurrent reserves with the SAME key create one reservation", async () => {
    const u = await seed(newOrg(), { onHand: 10 });
    const results = await Promise.all(Array.from({ length: 20 }, () => reserve(u, 4, "same")));
    expect(results.every((r) => r.reservationId === "same" && r.status === "reserved")).toBe(true);
    const s = await state(u);
    expect(s).toMatchObject({ onHand: 10, reserved: 4, available: 6 });
    expect(s.reservations).toHaveLength(1);
  }, 60_000);

  it("a retry of the same key and quantity returns the reservation whatever its status", async () => {
    const u = await seed(newOrg(), { onHand: 10 });
    await reserve(u, 2, "a");
    await reserve(u, 3, "b");
    await release(u, "a");
    await commit(u, "b");
    expect(await reserve(u, 2, "a")).toEqual({
      reservationId: "a",
      available: 7,
      status: "released",
    });
    expect(await reserve(u, 3, "b")).toEqual({
      reservationId: "b",
      available: 7,
      status: "committed",
    });
    expect(await state(u)).toMatchObject({ onHand: 7, reserved: 0, available: 7 });
  });

  it("the same key with a different quantity is a Conflict and changes nothing", async () => {
    const u = await seed(newOrg(), { onHand: 10 });
    await reserve(u, 2, "k");
    const err = await rejection(reserve(u, 3, "k"));
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as Error).message).toBe(
      "This idempotency key was already used with a different quantity",
    );
    expect(await state(u)).toMatchObject({ onHand: 10, reserved: 2, available: 8 });
    // also when the reservation is no longer active
    await release(u, "k");
    expect(await rejection(reserve(u, 5, "k"))).toBeInstanceOf(ConflictError);
    expect(await state(u)).toMatchObject({ reserved: 0, available: 10 });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1", null, undefined, 2 ** 53])(
    "rejects quantity %s with ValidationError and writes nothing",
    async (quantity) => {
      const u = await seed(newOrg(), { onHand: 10 });
      const err = await rejection(reserve(u, quantity as number, "k"));
      expect(err).toBeInstanceOf(ValidationError);
      const s = await state(u);
      expect(s).toMatchObject({ onHand: 10, reserved: 0 });
      expect(s.reservations).toHaveLength(0);
    },
  );

  it.each(["", "a/b", "..", ".", "__x__", "k".repeat(129), 5 as unknown as string])(
    "rejects idempotency key %j with ValidationError",
    async (key) => {
      const u = await seed(newOrg(), { onHand: 10 });
      expect(await rejection(reserve(u, 1, key))).toBeInstanceOf(ValidationError);
      expect(await rejection(release(u, key))).toBeInstanceOf(ValidationError);
      expect(await rejection(commit(u, key))).toBeInstanceOf(ValidationError);
      expect((await state(u)).reservations).toHaveLength(0);
    },
  );

  it("accepts a 128 character key", async () => {
    const u = await seed(newOrg(), { onHand: 10 });
    const key = "k".repeat(128);
    await reserve(u, 1, key);
    expect((await state(u)).reservations.map((r) => r.key)).toEqual([key]);
  });

  it("the same key on different stock units is a different reservation", async () => {
    const org = newOrg();
    const a = await seed(org, { onHand: 3 });
    const b = await seed(org, { onHand: 3 });
    await reserve(a, 1, "order-1");
    await reserve(b, 2, "order-1");
    expect(await state(a)).toMatchObject({ reserved: 1 });
    expect(await state(b)).toMatchObject({ reserved: 2 });
  });
});

describe("releaseStock", () => {
  it("restores availability, and a second release is a no-op", async () => {
    const u = await seed(newOrg(), { onHand: 5 });
    await reserve(u, 3, "k");
    await release(u, "k");
    expect(await state(u)).toMatchObject({ onHand: 5, reserved: 0, available: 5 });
    await release(u, "k");
    const s = await state(u);
    expect(s).toMatchObject({ onHand: 5, reserved: 0, available: 5 });
    expect(s.reservations[0]!.status).toBe("released");
  });

  it("concurrent double release decrements once", async () => {
    const u = await seed(newOrg(), { onHand: 10 });
    await reserve(u, 3, "k");
    await reserve(u, 2, "other");
    await Promise.all(Array.from({ length: 10 }, () => release(u, "k")));
    expect(await state(u)).toMatchObject({ onHand: 10, reserved: 2, available: 8 });
  }, 60_000);

  it("a released key stays released: re-reserving the same key does not re-reserve", async () => {
    const u = await seed(newOrg(), { onHand: 5 });
    await reserve(u, 3, "k");
    await release(u, "k");
    expect((await reserve(u, 3, "k")).status).toBe("released");
    expect(await state(u)).toMatchObject({ reserved: 0, available: 5 });
  });

  it("release after commit is a Conflict and changes nothing", async () => {
    const u = await seed(newOrg(), { onHand: 5 });
    await reserve(u, 3, "k");
    await commit(u, "k");
    expect(await rejection(release(u, "k"))).toBeInstanceOf(ConflictError);
    expect(await state(u)).toMatchObject({ onHand: 2, reserved: 0, available: 2 });
  });

  it("an unknown key is NotFound", async () => {
    const u = await seed(newOrg(), { onHand: 5 });
    expect(await rejection(release(u, "nope"))).toBeInstanceOf(NotFoundError);
    expect(await state(u)).toMatchObject({ onHand: 5, reserved: 0 });
  });
});

describe("commitStock", () => {
  it("moves the stock out once; a repeat (even concurrent) is a no-op", async () => {
    const u = await seed(newOrg(), { onHand: 10 });
    await reserve(u, 4, "k");
    await commit(u, "k");
    expect(await state(u)).toMatchObject({ onHand: 6, reserved: 0, available: 6 });
    await commit(u, "k");
    expect(await state(u)).toMatchObject({ onHand: 6, reserved: 0, available: 6 });

    await reserve(u, 2, "k2");
    await Promise.all(Array.from({ length: 10 }, () => commit(u, "k2")));
    const s = await state(u);
    expect(s).toMatchObject({ onHand: 4, reserved: 0, available: 4 });
    expect(s.reservations.map((r) => r.status)).toEqual(["committed", "committed"]);
  }, 60_000);

  it("commit after release is a Conflict and changes nothing", async () => {
    const u = await seed(newOrg(), { onHand: 5 });
    await reserve(u, 3, "k");
    await release(u, "k");
    expect(await rejection(commit(u, "k"))).toBeInstanceOf(ConflictError);
    expect(await state(u)).toMatchObject({ onHand: 5, reserved: 0, available: 5 });
  });

  it("an unknown key is NotFound", async () => {
    const u = await seed(newOrg(), { onHand: 5 });
    expect(await rejection(commit(u, "nope"))).toBeInstanceOf(NotFoundError);
  });

  it("concurrent commit + release of one key: exactly one wins and the counts match", async () => {
    for (let round = 0; round < 3; round++) {
      const u = await seed(newOrg(), { onHand: 10 });
      await reserve(u, 4, "k");
      await reserve(u, 1, "bystander");
      const [c, r] = await Promise.allSettled([commit(u, "k"), release(u, "k")]);
      expect([c.status, r.status].sort()).toEqual(["fulfilled", "rejected"]);
      const s = await state(u);
      const status = s.reservations.find((x) => x.key === "k")!.status;
      if (status === "committed") {
        expect(c.status).toBe("fulfilled");
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
        expect(s).toMatchObject({ onHand: 6, reserved: 1, available: 5 });
      } else {
        expect(status).toBe("released");
        expect(r.status).toBe("fulfilled");
        expect((c as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
        expect(s).toMatchObject({ onHand: 10, reserved: 1, available: 9 });
      }
    }
  }, 60_000);
});

describe("tenancy and missing documents", () => {
  it("another organization's inventory is NotFound for every mutator, with no change", async () => {
    const owner = newOrg();
    const intruder = newOrg();
    const u = await seed(owner, { onHand: 5 });
    await reserve(u, 2, "k");
    const before = await state(u);

    const foreign = { ...u, org: intruder };
    expect(await rejection(reserve(foreign, 1, "x"))).toBeInstanceOf(NotFoundError);
    expect(await rejection(release(foreign, "k"))).toBeInstanceOf(NotFoundError);
    expect(await rejection(commit(foreign, "k"))).toBeInstanceOf(NotFoundError);
    expect(await rejection(adjust(foreign, 5))).toBeInstanceOf(NotFoundError);

    const after = await state(u);
    expect(after.onHand).toBe(before.onHand);
    expect(after.reserved).toBe(before.reserved);
    expect(after.reservations).toEqual(before.reservations);
    expect(
      await db().collection("auditLogs").where("organizationId", "==", intruder).get(),
    ).toHaveProperty("empty", true);
  });

  it("missing and malformed ids are NotFound (no oracle)", async () => {
    const org = newOrg();
    const missing = { org, productId: "ghost", variantId: "default", id: "ghost__default" };
    const badVariant = { org, productId: "ghost", variantId: "Not Valid!", id: "x" };
    const badProduct = { org, productId: "a/b", variantId: "default", id: "x" };
    for (const u of [missing, badVariant, badProduct]) {
      expect(await rejection(reserve(u, 1, "k"))).toBeInstanceOf(NotFoundError);
      expect(await rejection(release(u, "k"))).toBeInstanceOf(NotFoundError);
      expect(await rejection(commit(u, "k"))).toBeInstanceOf(NotFoundError);
      expect(await rejection(adjust(u, 1))).toBeInstanceOf(NotFoundError);
    }
    expect(
      (await db().collection("inventory").where("organizationId", "==", org).get()).empty,
    ).toBe(true);
  });

  it("a reservation of another organization under the same key is not usable", async () => {
    const org = newOrg();
    const u = await seed(org, { onHand: 5 });
    await resDoc(u, "k").set({
      organizationId: "someone-else",
      quantity: 1,
      status: "reserved",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // Corrupt data: generic internal error, nothing changes.
    expect(isInternal(await rejection(reserve(u, 1, "k")))).toBe(true);
    expect(isInternal(await rejection(release(u, "k")))).toBe(true);
    expect(isInternal(await rejection(commit(u, "k")))).toBe(true);
    expect(
      await invDoc(u)
        .get()
        .then((d) => d.get("reserved")),
    ).toBe(0);
  });
});

describe("corruption guard", () => {
  const bad: Array<[string, { onHand: number; reserved?: number; available?: number }]> = [
    ["available is wrong", { onHand: 5, reserved: 0, available: 4 }],
    ["negative onHand", { onHand: -1, reserved: 0, available: -1 }],
    ["negative reserved", { onHand: 5, reserved: -1, available: 6 }],
    ["fractional count", { onHand: 1.5, reserved: 0, available: 1.5 }],
    ["reserved exceeds onHand", { onHand: 2, reserved: 3, available: -1 }],
    ["non-number count", { onHand: "5" as unknown as number, reserved: 0, available: 5 }],
  ];

  it.each(bad)(
    "%s: every mutator throws an internal Error and writes nothing",
    async (_n, counts) => {
      const u = await seed(newOrg(), counts);
      await resDoc(u, "k").set({
        organizationId: u.org,
        quantity: 1,
        status: "reserved",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const snapshot = async () => ({
        inv: (await invDoc(u).get()).data(),
        res: (await resDoc(u, "k").get()).data(),
        reservations: (await reservationsOf(u)).length,
        audits: (await db().collection("auditLogs").where("organizationId", "==", u.org).get())
          .size,
      });
      const before = await snapshot();
      const errs = [
        await rejection(reserve(u, 1, "new")),
        await rejection(release(u, "k")),
        await rejection(commit(u, "k")),
        await rejection(adjust(u, 1)),
      ];
      for (const e of errs) {
        expect(isInternal(e)).toBe(true);
        expect((e as Error).message).toBe("Inventory record is inconsistent");
      }
      expect(await snapshot()).toEqual(before);
    },
  );

  it("a corrupt reservation (bad status or quantity) is an internal Error and writes nothing", async () => {
    const u = await seed(newOrg(), { onHand: 5, reserved: 1 });
    for (const [key, data] of [
      ["s", { quantity: 1, status: "weird" }],
      ["q0", { quantity: 0, status: "reserved" }],
      ["qf", { quantity: 1.5, status: "reserved" }],
      ["qs", { quantity: "1", status: "reserved" }],
    ] as const) {
      await resDoc(u, key).set({
        organizationId: u.org,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      for (const op of [() => reserve(u, 1, key), () => release(u, key), () => commit(u, key)]) {
        expect(isInternal(await rejection(op()))).toBe(true);
      }
    }
    expect(
      await invDoc(u)
        .get()
        .then((d) => d.data()),
    ).toMatchObject({ onHand: 5, reserved: 1, available: 4 });
  });

  it("a reservation larger than reserved (would go negative) is refused, never clamped", async () => {
    const u = await seed(newOrg(), { onHand: 5, reserved: 1 });
    await resDoc(u, "big").set({
      organizationId: u.org,
      quantity: 3,
      status: "reserved",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(isInternal(await rejection(release(u, "big")))).toBe(true);
    expect(isInternal(await rejection(commit(u, "big")))).toBe(true);
    expect((await resDoc(u, "big").get()).get("status")).toBe("reserved");
    expect(
      await invDoc(u)
        .get()
        .then((d) => d.data()),
    ).toMatchObject({ onHand: 5, reserved: 1, available: 4 });
  });
});

describe("adjustStock", () => {
  it("adds and removes stock, returns the record and audits before/after in one transaction", async () => {
    const org = newOrg();
    const u = await seed(org, { onHand: 5 });
    await reserve(u, 2, "k");

    const rec = await adjust(u, 10, "  Received shipment ", "uid-actor");
    expect(rec).toMatchObject({
      id: u.id,
      organizationId: org,
      productId: u.productId,
      variantId: u.variantId,
      onHand: 15,
      reserved: 2,
      available: 13,
    });
    expect(rec.updatedAt).toMatch(/^\d{4}-/);
    const rec2 = await adjust(u, -3, "Damaged");
    expect(rec2).toMatchObject({ onHand: 12, reserved: 2, available: 10 });
    expect(await state(u)).toMatchObject({ onHand: 12, reserved: 2, available: 10 });

    const logs = (await db().collection("auditLogs").where("organizationId", "==", org).get()).docs
      .map((d) => d.data())
      .sort((a, b) => a.after.delta - b.after.delta);
    expect(logs).toHaveLength(2);
    const first = logs.find((l) => l.after.delta === 10)!;
    expect(first).toMatchObject({
      action: "inventory.adjust",
      resource: "inventory",
      resourceId: u.id,
      actorUid: "uid-actor",
      before: { onHand: 5, reserved: 2, available: 3 },
      after: { onHand: 15, reserved: 2, available: 13, delta: 10, reason: "Received shipment" },
    });
  });

  it("may reduce onHand down to exactly reserved, not below (Conflict, nothing written)", async () => {
    const org = newOrg();
    const u = await seed(org, { onHand: 5 });
    await reserve(u, 3, "k");
    expect(await adjust(u, -2)).toMatchObject({ onHand: 3, reserved: 3, available: 0 });
    const err = await rejection(adjust(u, -1));
    expect(err).toBeInstanceOf(ConflictError);
    expect(await state(u)).toMatchObject({ onHand: 3, reserved: 3, available: 0 });
    expect((await db().collection("auditLogs").where("organizationId", "==", org).get()).size).toBe(
      1,
    );
  });

  it("refuses to go below zero with nothing reserved", async () => {
    const u = await seed(newOrg(), { onHand: 2 });
    expect(await rejection(adjust(u, -3))).toBeInstanceOf(ConflictError);
    expect(await state(u)).toMatchObject({ onHand: 2 });
  });

  it("refuses a result above 1,000,000,000 with ValidationError", async () => {
    const u = await seed(newOrg(), { onHand: 999_999_999 });
    expect(await rejection(adjust(u, 2))).toBeInstanceOf(ValidationError);
    expect(await adjust(u, 1)).toMatchObject({ onHand: 1_000_000_000 });
    expect(await state(u)).toMatchObject({ onHand: 1_000_000_000 });
  });

  it.each([0, 1.5, 1_000_001, -1_000_001, Number.NaN, Number.POSITIVE_INFINITY, "5"])(
    "rejects delta %s with ValidationError and writes nothing",
    async (delta) => {
      const u = await seed(newOrg(), { onHand: 5 });
      expect(await rejection(adjust(u, delta as number))).toBeInstanceOf(ValidationError);
      expect(await state(u)).toMatchObject({ onHand: 5 });
    },
  );

  it.each(["", "  ", "ab", "x".repeat(201), undefined, 5])("rejects reason %j", async (reason) => {
    const u = await seed(newOrg(), { onHand: 5 });
    const err = await rejection(
      adjustStock({ organizationId: u.org, uid: "u" }, u.productId, u.variantId, {
        delta: 1,
        reason: reason as string,
      }),
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect(await state(u)).toMatchObject({ onHand: 5 });
  });

  it("fails closed without a valid organization / user context", async () => {
    const u = await seed(newOrg(), { onHand: 5 });
    await expect(
      adjustStock({ organizationId: "", uid: "u" }, u.productId, u.variantId, {
        delta: 1,
        reason: "abc",
      }),
    ).rejects.toThrow(/requires an organization/);
    await expect(
      adjustStock({ organizationId: u.org, uid: " " }, u.productId, u.variantId, {
        delta: 1,
        reason: "abc",
      }),
    ).rejects.toThrow(/requires an organization/);
    expect(await state(u)).toMatchObject({ onHand: 5 });
  });

  it("leaves the counters unchanged when the audit write fails", async () => {
    const org = newOrg();
    const u = await seed(org, { onHand: 5 });
    audit.fail = true;
    await expect(adjust(u, 4)).rejects.toThrow("audit unavailable");
    audit.fail = false;
    expect(await state(u)).toMatchObject({ onHand: 5, reserved: 0, available: 5 });
    expect((await db().collection("auditLogs").where("organizationId", "==", org).get()).size).toBe(
      0,
    );
  });

  it("concurrent adjusts all apply exactly once", async () => {
    const org = newOrg();
    const u = await seed(org, { onHand: 0 });
    await Promise.all(Array.from({ length: 12 }, () => adjust(u, 5)));
    expect(await state(u)).toMatchObject({ onHand: 60, available: 60 });
    expect((await db().collection("auditLogs").where("organizationId", "==", org).get()).size).toBe(
      12,
    );
  }, 60_000);

  it("concurrent reserve and negative adjust never leave onHand below reserved", async () => {
    const u = await seed(newOrg(), { onHand: 10 });
    const ops = [
      ...Array.from({ length: 10 }, (_, i) => reserve(u, 1, `r${i}`)),
      ...Array.from({ length: 10 }, () => adjust(u, -1)),
    ];
    const results = await Promise.allSettled(ops);
    for (const r of results) {
      if (r.status === "rejected") {
        expect(
          r.reason instanceof InsufficientStockError || r.reason instanceof ConflictError,
        ).toBe(true);
      }
    }
    const s = await state(u);
    expect(s.onHand).toBeGreaterThanOrEqual(s.reserved);
  }, 60_000);
});

describe("contention (through the real SDK retry loop)", () => {
  const abortedError = () =>
    Object.assign(new Error("10 ABORTED: too much contention on these documents"), { code: 10 });

  // The SDK's backoff module is not importable by specifier (package exports map), so load it by
  // file path. It is the same module instance the SDK itself uses.
  const nodeRequire = createRequire(import.meta.url);
  const backoff = nodeRequire(
    path.join(
      path.dirname(nodeRequire.resolve("@google-cloud/firestore/package.json")),
      "build/src/backoff.js",
    ),
  ) as {
    delayExecution: unknown;
    setTimeoutHandler: (h: (f: () => void, ms: number) => void) => void;
  };
  const realDelay = backoff.delayExecution;
  let delays: number[] = [];
  let getAllSpy: MockInstance | undefined;
  let getSpy: MockInstance | undefined;
  let warn: MockInstance;
  const getAllCalls = () => getAllSpy!.mock.calls.length;

  beforeEach(() => {
    delays = [];
    // Zero the real waits but record what the SDK asked for.
    backoff.setTimeoutHandler((f, ms) => {
      delays.push(ms);
      setImmediate(f);
    });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    backoff.delayExecution = realDelay;
    getAllSpy?.mockRestore();
    getSpy?.mockRestore();
    getAllSpy = undefined;
    getSpy = undefined;
    warn.mockRestore();
  });

  const failReads = (error: () => Error) => {
    getAllSpy = vi.spyOn(Transaction.prototype, "getAll").mockRejectedValue(error());
    getSpy = vi.spyOn(Transaction.prototype, "get").mockRejectedValue(error());
  };

  it.each([
    ["reserve", (u: Unit) => reserve(u, 1, "k")],
    ["release", (u: Unit) => release(u, "k")],
    ["commit", (u: Unit) => commit(u, "k")],
  ])(
    "%s: persistent ABORTED runs the callback exactly 11 times, then InventoryBusyError",
    async (_name, op) => {
      const u = await seed(newOrg(), { onHand: 5 });
      failReads(abortedError);
      const err = await rejection(op(u));
      expect(err).toBeInstanceOf(InventoryBusyError);
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as InventoryBusyError).code).toBe("CONFLICT");
      expect((err as Error).message).toBe("Inventory is busy, please try again");
      expect(RESERVATION_MAX_ATTEMPTS).toBe(11);
      expect(getAllCalls()).toBe(11);
      // The SDK asks for a wait before every attempt: none before the first, then 10 backoff
      // waits, the first about 1 s (+/- 50% jitter) and the last about 38 s.
      expect(delays).toHaveLength(11);
      expect(delays[0]).toBe(0);
      expect(delays[1]).toBeGreaterThanOrEqual(500);
      expect(delays[1]).toBeLessThanOrEqual(1500);
      expect(delays[10]).toBeGreaterThan(19_000);
      const total = delays.reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(55_000);
      expect(total).toBeLessThan(170_000);
      // exhaustion is logged (an AppError response is not) with the inventory id only
      const line = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(line).toContain("inventoryId");
      expect(line).toContain(u.id);
    },
  );

  it("adjust: persistent ABORTED runs 5 times (4 waits, about 8 s), then InventoryBusyError", async () => {
    const u = await seed(newOrg(), { onHand: 5 });
    failReads(abortedError);
    const err = await rejection(adjust(u, 1));
    expect(err).toBeInstanceOf(InventoryBusyError);
    expect(ADJUST_MAX_ATTEMPTS).toBe(5);
    expect(getSpy!.mock.calls.length).toBe(5);
    expect(delays).toHaveLength(5); // none before the first attempt, then 4 backoff waits
    expect(delays[0]).toBe(0);
    expect(delays.reduce((a, b) => a + b, 0)).toBeLessThan(16_000);
    getSpy!.mockRestore();
    getSpy = undefined;
    expect(await state(u)).toMatchObject({ onHand: 5 });
    expect(
      (await db().collection("auditLogs").where("organizationId", "==", u.org).get()).size,
    ).toBe(0);
  });

  it.each([
    ["UNAVAILABLE", 14],
    ["RESOURCE_EXHAUSTED", 8],
    ["DEADLINE_EXCEEDED", 4],
  ])("persistent %s is NOT reported as busy: the real error propagates", async (_n, code) => {
    const u = await seed(newOrg(), { onHand: 5 });
    failReads(() => Object.assign(new Error(`${code} outage`), { code }));
    for (const op of [() => reserve(u, 1, "k"), () => release(u, "k"), () => commit(u, "k")]) {
      const err = await rejection(op());
      expect(err).not.toBeInstanceOf(InventoryBusyError);
      expect(err).not.toBeInstanceOf(ConflictError);
      expect(isAppError(err)).toBe(false);
      expect((err as { code?: number }).code).toBe(code);
      expect((err as Error).message).toBe(`${code} outage`);
    }
    const err = await rejection(adjust(u, 1));
    expect((err as { code?: number }).code).toBe(code);
    expect(err).not.toBeInstanceOf(InventoryBusyError);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a non-retryable error is not retried and not disguised", async () => {
    const u = await seed(newOrg(), { onHand: 5 });
    failReads(() => new Error("boom"));
    await expect(reserve(u, 1, "k")).rejects.toThrow("boom");
    expect(getAllCalls()).toBe(1);
    expect(delays.filter((d) => d > 0)).toHaveLength(0);
  });

  it("ABORTED a few times and then success: the retry re-reads and applies exactly once", async () => {
    const u = await seed(newOrg(), { onHand: 5 });
    const original = Transaction.prototype.getAll as (...a: unknown[]) => Promise<unknown>;
    let calls = 0;
    getAllSpy = vi.spyOn(Transaction.prototype, "getAll").mockImplementation(function (
      this: Transaction,
      ...refs: unknown[]
    ) {
      calls += 1;
      if (calls <= 3) return Promise.reject(abortedError());
      return original.apply(this, refs) as never;
    });
    expect(await reserve(u, 2, "k")).toMatchObject({ status: "reserved", available: 3 });
    expect(calls).toBe(4);
    expect(delays.filter((d) => d > 0).length).toBeGreaterThanOrEqual(3);
    getAllSpy.mockRestore();
    getAllSpy = undefined;
    expect(await state(u)).toMatchObject({ onHand: 5, reserved: 2, available: 3 });
  });
});

describe("reserve racing a variant removal", () => {
  async function twoVariantProduct() {
    const org = newOrg();
    const ctx = { organizationId: org, uid: "uid-1" };
    const p = await createProduct(
      ctx,
      productInputSchema.parse({
        name: `Race ${randomUUID().slice(0, 6)}`,
        sku: `race-${randomUUID().slice(0, 8)}`,
        regularPriceMinor: 1000,
        variants: [{ size: "S" }, { size: "M" }],
      }),
    );
    const [keep, drop] = p.variants;
    const unit = (v: { id: string }): Unit => ({
      org,
      productId: p.id,
      variantId: v.id,
      id: `${p.id}__${v.id}`,
    });
    const removeDrop = () =>
      updateProduct(
        ctx,
        p.id,
        productPatchSchema.parse({ variants: [{ id: keep!.id, size: "S" }] }),
      );
    return { drop: unit(drop!), removeDrop };
  }

  it("a stocked variant cannot be removed while reserves run: removal Conflicts, nothing is lost", async () => {
    const { drop, removeDrop } = await twoVariantProduct();
    await db().collection("inventory").doc(drop.id).update({ onHand: 4, available: 4 });
    const [removal, ...reserves] = await Promise.allSettled([
      removeDrop(),
      ...Array.from({ length: 3 }, (_, i) => reserve(drop, 1, `r${i}`)),
    ]);
    expect(removal.status).toBe("rejected");
    expect((removal as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect(reserves.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await state(drop)).toMatchObject({ onHand: 4, reserved: 3, available: 1 });
  }, 90_000);

  it("an empty variant: the reserve can never succeed and no orphan reservation is left", async () => {
    for (let round = 0; round < 3; round++) {
      const { drop, removeDrop } = await twoVariantProduct();
      const [removal, res] = await Promise.allSettled([removeDrop(), reserve(drop, 1, "k")]);
      expect(res.status).toBe("rejected");
      const reason = (res as PromiseRejectedResult).reason;
      expect(reason instanceof InsufficientStockError || reason instanceof NotFoundError).toBe(
        true,
      );
      const invExists = (await db().collection("inventory").doc(drop.id).get()).exists;
      expect(invExists).toBe(removal.status !== "fulfilled");
      expect((await reservationsOf(drop)).length).toBe(0);
    }
  }, 90_000);

  it("once a variant has been reserved, it can never be removed", async () => {
    const { drop, removeDrop } = await twoVariantProduct();
    await db().collection("inventory").doc(drop.id).update({ onHand: 2, available: 2 });
    await reserve(drop, 1, "k");
    await release(drop, "k");
    await adjust(drop, -2); // counters back to zero; only the reservation record remains
    expect(await state(drop)).toMatchObject({ onHand: 0, reserved: 0, available: 0 });
    await expect(removeDrop()).rejects.toBeInstanceOf(ConflictError);
    expect((await db().collection("inventory").doc(drop.id).get()).exists).toBe(true);
  }, 90_000);
});

// ---- randomized mixed sequences ---------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("randomized mixed sequences", () => {
  it.each([1])(
    "seed %s: ~100 reserve/release/commit/adjust ops in concurrent batches keep every invariant",
    async (seedNo) => {
      const rnd = mulberry32(seedNo * 7919);
      const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
      const initial = 20;
      const u = await seed(newOrg(), { onHand: initial });
      const keys = Array.from({ length: 24 }, (_, i) => `key-${i}`);
      const qty = new Map<string, number>(); // first quantity ever used per key
      let adjustedTotal = 0;
      let ops = 0;

      const tolerated = (e: unknown) =>
        e instanceof InsufficientStockError ||
        e instanceof ConflictError ||
        e instanceof NotFoundError ||
        e instanceof ValidationError;

      while (ops < 100) {
        const batchSize = rnd() < 0.5 ? 1 : int(2, 8);
        const batch: Array<Promise<{ delta?: number }>> = [];
        for (let i = 0; i < batchSize; i++, ops++) {
          const key = keys[int(0, keys.length - 1)]!;
          const pick = rnd();
          if (pick < 0.4) {
            const q = qty.get(key) ?? int(1, 4);
            // 1 in 8 reuse a key with another quantity (must be a Conflict, never a double spend)
            const used = rnd() < 0.125 ? q + 1 : q;
            if (!qty.has(key)) qty.set(key, q);
            batch.push(reserve(u, used, key).then(() => ({})));
          } else if (pick < 0.6) {
            batch.push(release(u, key).then(() => ({})));
          } else if (pick < 0.8) {
            batch.push(commit(u, key).then(() => ({})));
          } else {
            const delta = (rnd() < 0.5 ? -1 : 1) * int(1, 6);
            batch.push(adjust(u, delta).then(() => ({ delta })));
          }
        }
        const results = await Promise.allSettled(batch);
        for (const r of results) {
          if (r.status === "fulfilled") adjustedTotal += r.value.delta ?? 0;
          else expect(tolerated(r.reason), String(r.reason)).toBe(true);
        }
        // invariants after every batch
        const s = await state(u);
        const committed = s.reservations
          .filter((r) => r.status === "committed")
          .reduce((a, r) => a + r.quantity, 0);
        expect(s.onHand).toBe(initial + adjustedTotal - committed);
      }
    },
    180_000,
  );
});
