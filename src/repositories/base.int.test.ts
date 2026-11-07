import { randomUUID } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import { ConflictError, isAppError, NotFoundError, ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { decodeCursor, encodeCursor } from "@/lib/pagination";

import { OrgRepository } from "./base";

interface Item {
  id: string;
  organizationId: string;
  name: string;
  rank: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}
type NewItem = { name: string; rank: number; status: string } & Record<string, unknown>;

const COLLECTION = `repoTest_${randomUUID()}`;
const repo = new OrgRepository<Item>(COLLECTION, {
  filterable: ["status", "rank"],
  sortable: ["rank", "createdAt", "name"],
});

const newOrg = () => `org-${randomUUID()}`;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

afterAll(async () => {
  await adminDb().recursiveDelete(adminDb().collection(COLLECTION));
});

async function expectRejects<E extends Error>(
  promise: Promise<unknown>,
  type: new (...args: never[]) => E,
): Promise<E> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(type);
    return error as E;
  }
  throw new Error(`expected rejection with ${type.name}`);
}

async function seed(orgId: string, count: number, rankOf: (i: number) => number = (i) => i) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const item = await repo.create(orgId, {
      name: `n${i}`,
      rank: rankOf(i),
      status: i % 2 === 0 ? "open" : "closed",
    } as NewItem);
    ids.push(item.id);
  }
  return ids;
}

async function pageAll(orgId: string, q: Omit<Parameters<typeof repo.list>[1], "cursor">) {
  const pages: Item[][] = [];
  const cursors: (string | null)[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 20; guard++) {
    const res = await repo.list(orgId, { ...q, cursor });
    pages.push(res.items);
    cursors.push(res.nextCursor);
    if (res.nextCursor === null) break;
    cursor = res.nextCursor;
  }
  return { pages, cursors };
}

describe("constructor", () => {
  it("refuses to make organizationId filterable", () => {
    expect(() => new OrgRepository<Item>("x", { filterable: ["organizationId"] })).toThrow();
  });
});

describe("create / get", () => {
  it("forces organizationId and ignores id/createdAt/updatedAt in data", async () => {
    const orgId = newOrg();
    const created = await repo.create(orgId, {
      name: "a",
      rank: 1,
      status: "open",
      organizationId: "org-evil",
      id: "evil-id",
      createdAt: "1999-01-01T00:00:00.000Z",
      updatedAt: "1999-01-01T00:00:00.000Z",
    } as NewItem);
    expect(created.organizationId).toBe(orgId);
    expect(created.id).not.toBe("evil-id");
    expect(created.createdAt).toMatch(ISO);
    expect(created.createdAt.startsWith("1999")).toBe(false);
    expect(created.updatedAt.startsWith("1999")).toBe(false);

    const fetched = await repo.get(orgId, created.id);
    expect(fetched).toEqual(created);
    expect(await repo.get("org-evil", created.id)).toBeNull();

    const raw = (await adminDb().collection(COLLECTION).doc(created.id).get()).data()!;
    expect(raw.createdAt).toBeInstanceOf(Timestamp);
    expect(raw.updatedAt).toBeInstanceOf(Timestamp);
    expect(raw.organizationId).toBe(orgId);
    expect("id" in raw).toBe(false);
  });

  it("uses an explicit id and returns ConflictError when it already exists", async () => {
    const orgId = newOrg();
    const id = `fixed-${randomUUID()}`;
    const created = await repo.create(orgId, { name: "a", rank: 1, status: "open" } as NewItem, id);
    expect(created.id).toBe(id);
    await expectRejects(
      repo.create(orgId, { name: "b", rank: 2, status: "open" } as NewItem, id),
      ConflictError,
    );
    // A different org cannot take over the id either: still a conflict, original untouched.
    await expectRejects(
      repo.create(newOrg(), { name: "c", rank: 3, status: "open" } as NewItem, id),
      ConflictError,
    );
    expect((await repo.get(orgId, id))?.name).toBe("a");
  });

  it("get returns null for a missing doc", async () => {
    expect(await repo.get(newOrg(), `missing-${randomUUID()}`)).toBeNull();
  });

  it("serializes Timestamps to ISO strings at the top level and one level nested", async () => {
    const orgId = newOrg();
    const id = `ts-${randomUUID()}`;
    const when = Timestamp.fromDate(new Date("2026-03-04T05:06:07.089Z"));
    await adminDb()
      .collection(COLLECTION)
      .doc(id)
      .set({
        organizationId: orgId,
        name: "t",
        rank: 1,
        status: "open",
        dueAt: when,
        nested: { seenAt: when, label: "x" },
        list: [when],
      });
    const item = await repo.get(orgId, id);
    expect(item?.dueAt).toBe("2026-03-04T05:06:07.089Z");
    expect((item?.nested as { seenAt: unknown }).seenAt).toBe("2026-03-04T05:06:07.089Z");
    expect((item?.nested as { label: string }).label).toBe("x");
    expect(item?.list).toEqual(["2026-03-04T05:06:07.089Z"]);
  });
});

describe("update / remove", () => {
  it("updates fields, bumps updatedAt, and cannot change organizationId/createdAt/id", async () => {
    const orgId = newOrg();
    const created = await repo.create(orgId, { name: "a", rank: 1, status: "open" } as NewItem);
    const updated = await repo.update(orgId, created.id, {
      name: "b",
      organizationId: "org-evil",
      createdAt: "1999-01-01T00:00:00.000Z",
      id: "evil",
    } as Partial<Item>);
    expect(updated.name).toBe("b");
    expect(updated.organizationId).toBe(orgId);
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );
    expect(await repo.get("org-evil", created.id)).toBeNull();
    expect((await repo.get(orgId, created.id))?.name).toBe("b");
  });

  it("treats dotted patch keys as literal field names", async () => {
    const orgId = newOrg();
    const created = await repo.create(orgId, {
      name: "a",
      rank: 1,
      status: "open",
      meta: { keep: 1 },
    } as NewItem);
    await repo.update(orgId, created.id, { "meta.x": 5 } as Partial<Item>);
    const raw = (await adminDb().collection(COLLECTION).doc(created.id).get()).data()!;
    expect(raw["meta.x"]).toBe(5);
    expect(raw.meta).toEqual({ keep: 1 });
  });

  it("update / remove across orgs or on missing docs -> NotFoundError and nothing changes", async () => {
    const a = newOrg();
    const b = newOrg();
    const created = await repo.create(a, { name: "a", rank: 1, status: "open" } as NewItem);
    await expectRejects(repo.update(b, created.id, { name: "hacked" }), NotFoundError);
    await expectRejects(repo.remove(b, created.id), NotFoundError);
    await expectRejects(repo.update(a, `missing-${randomUUID()}`, { name: "x" }), NotFoundError);
    await expectRejects(repo.remove(a, `missing-${randomUUID()}`), NotFoundError);
    expect((await repo.get(a, created.id))?.name).toBe("a");
  });

  it("remove deletes the doc for the owning org", async () => {
    const orgId = newOrg();
    const created = await repo.create(orgId, { name: "a", rank: 1, status: "open" } as NewItem);
    await repo.remove(orgId, created.id);
    expect(await repo.get(orgId, created.id)).toBeNull();
  });
});

describe("id validation", () => {
  it("rejects invalid org ids and doc ids with ValidationError", async () => {
    const orgId = newOrg();
    for (const bad of ["", "a/b", "..", ".", "x".repeat(1501)]) {
      await expectRejects(repo.get(bad, "id"), ValidationError);
      await expectRejects(repo.get(orgId, bad), ValidationError);
      await expectRejects(
        repo.create(bad, { name: "a", rank: 1, status: "open" } as NewItem),
        ValidationError,
      );
      await expectRejects(
        repo.create(orgId, { name: "a", rank: 1, status: "open" } as NewItem, bad),
        ValidationError,
      );
      await expectRejects(repo.update(orgId, bad, {}), ValidationError);
      await expectRejects(repo.update(bad, "id", {}), ValidationError);
      await expectRejects(repo.remove(orgId, bad), ValidationError);
      await expectRejects(repo.list(bad, { orderBy: ["rank", "asc"], limit: 5 }), ValidationError);
      expect(() => repo.docRef(bad)).toThrow(ValidationError);
      expect(() => repo.build(bad, { name: "a" } as NewItem)).toThrow(ValidationError);
      expect(() => repo.build(orgId, { name: "a" } as NewItem, bad)).toThrow(ValidationError);
    }
    await expectRejects(repo.get(undefined as unknown as string, "id"), ValidationError);
    await expectRejects(repo.get(5 as unknown as string, "id"), ValidationError);
  });
});

describe("list", () => {
  it("never returns another org's docs, with three orgs seeded", async () => {
    const [a, b, c] = [newOrg(), newOrg(), newOrg()];
    await seed(a, 4);
    await seed(b, 5);
    await seed(c, 6);
    for (const [org, n] of [
      [a, 4],
      [b, 5],
      [c, 6],
    ] as const) {
      const res = await repo.list(org, { orderBy: ["rank", "asc"], limit: 100 });
      expect(res.items).toHaveLength(n);
      expect(res.items.every((i) => i.organizationId === org)).toBe(true);
      expect(res.nextCursor).toBeNull();
    }
  });

  it("paginates 25 docs with limit 10 as 10/10/5 with no duplicates and a null final cursor", async () => {
    const orgId = newOrg();
    const ids = await seed(orgId, 25);
    await seed(newOrg(), 7);
    const { pages, cursors } = await pageAll(orgId, { orderBy: ["rank", "asc"], limit: 10 });
    expect(pages.map((p) => p.length)).toEqual([10, 10, 5]);
    expect(cursors[0]).not.toBeNull();
    expect(cursors[1]).not.toBeNull();
    expect(cursors[2]).toBeNull();
    const seen = pages.flat().map((i) => i.id);
    expect(new Set(seen).size).toBe(25);
    expect(seen).toEqual(ids); // rank == creation index
  });

  it("returns a null cursor when the result exactly fills the limit", async () => {
    const orgId = newOrg();
    await seed(orgId, 10);
    const res = await repo.list(orgId, { orderBy: ["rank", "asc"], limit: 10 });
    expect(res.items).toHaveLength(10);
    expect(res.nextCursor).toBeNull();
  });

  it("is stable with duplicate sort values (id tie-breaker)", async () => {
    const orgId = newOrg();
    await seed(orgId, 25, (i) => i % 3);
    const { pages } = await pageAll(orgId, { orderBy: ["rank", "asc"], limit: 4 });
    const flat = pages.flat();
    expect(flat).toHaveLength(25);
    expect(new Set(flat.map((i) => i.id)).size).toBe(25);
    const expected = [...flat].sort((x, y) => x.rank - y.rank || (x.id < y.id ? -1 : 1));
    expect(flat.map((i) => i.id)).toEqual(expected.map((i) => i.id));
  });

  it("supports descending order", async () => {
    const orgId = newOrg();
    await seed(orgId, 25, (i) => i % 3);
    const { pages } = await pageAll(orgId, { orderBy: ["rank", "desc"], limit: 10 });
    const flat = pages.flat();
    expect(flat).toHaveLength(25);
    expect(new Set(flat.map((i) => i.id)).size).toBe(25);
    for (let i = 1; i < flat.length; i++)
      expect(flat[i - 1]!.rank).toBeGreaterThanOrEqual(flat[i]!.rank);
  });

  it("paginates timestamps that differ by microseconds or are identical (nanosecond cursors + id tie-breaker)", async () => {
    // All 12 docs fall inside ONE millisecond. A cursor truncated to ms would restart inside
    // that millisecond and return duplicates / loop; identical pairs force the id tie-break.
    const orgId = newOrg();
    const seconds = Math.floor(Date.parse("2026-05-06T07:08:09Z") / 1000);
    const col = adminDb().collection(COLLECTION);
    const written: { id: string; nanos: number }[] = [];
    for (let k = 0; k < 6; k++) {
      for (let dup = 0; dup < 2; dup++) {
        const id = `mu-${randomUUID()}`;
        const nanos = 123_000_000 + k * 1000; // microsecond steps, same millisecond
        await col.doc(id).set({
          organizationId: orgId,
          name: id,
          rank: k,
          status: "open",
          createdAt: new Timestamp(seconds, nanos),
          updatedAt: new Timestamp(seconds, nanos),
        });
        written.push({ id, nanos });
      }
    }
    for (const dir of ["asc", "desc"] as const) {
      const sign = dir === "asc" ? 1 : -1;
      const expected = [...written]
        .sort((x, y) => sign * (x.nanos - y.nanos || (x.id < y.id ? -1 : 1)))
        .map((w) => w.id);
      const { pages } = await pageAll(orgId, { orderBy: ["createdAt", dir], limit: 5 });
      expect(pages.map((p) => p.length)).toEqual([5, 5, 2]);
      expect(pages.flat().map((i) => i.id)).toEqual(expected);
    }
  });

  it("rejects forged timestamp cursors with ValidationError (never a raw Error)", async () => {
    const orgId = newOrg();
    await seed(orgId, 2);
    const forged = [
      "0000-01-01T00:00:00.000000000Z", // below Firestore's minimum
      "0000-12-31T23:59:59.999999999Z",
      "2026-02-31T00:00:00.000000000Z", // rolls over
      "2026-13-01T00:00:00.000000000Z",
      "2026-01-01T00:00:00.000Z", // not full precision
    ];
    for (const v of forged) {
      const err = await expectRejects(
        repo.list(orgId, {
          orderBy: ["createdAt", "asc"],
          limit: 5,
          cursor: encodeCursor({ t: "ts", v, id: "x" }),
        }),
        ValidationError,
      );
      expect(JSON.stringify(err.details)).not.toContain(v);
    }
    // The upper bound (year 9999) is valid and simply yields an empty page.
    const res = await repo.list(orgId, {
      orderBy: ["createdAt", "asc"],
      limit: 5,
      cursor: encodeCursor({ t: "ts", v: "9999-12-31T23:59:59.999999999Z", id: "x" }),
    });
    expect(res.items).toEqual([]);
  });

  it("throws a plain internal Error (not a 400) when the last row's sort value cannot be a cursor key", async () => {
    const col = adminDb().collection(COLLECTION);
    const cases: Record<string, unknown>[] = [
      { name: "x".repeat(257) },
      { name: ["a", "b"] },
      { name: { nested: "map" } },
    ];
    for (const extra of cases) {
      const orgId = newOrg();
      for (let i = 0; i < 2; i++) {
        await col
          .doc(`bad-${randomUUID()}`)
          .set({ organizationId: orgId, rank: i, status: "open", ...extra });
      }
      let thrown: unknown;
      try {
        await repo.list(orgId, { orderBy: ["name", "asc"], limit: 1 });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).not.toBeInstanceOf(ValidationError);
      expect(isAppError(thrown)).toBe(false);
      expect((thrown as Error).message).not.toContain("xxxx");
    }
  });

  it("accepts the largest allowed string sort key (256 chars) and paginates over it", async () => {
    const orgId = newOrg();
    const col = adminDb().collection(COLLECTION);
    for (let i = 0; i < 3; i++) {
      await col
        .doc(`long-${randomUUID()}`)
        .set({ organizationId: orgId, rank: i, status: "open", name: `${"é".repeat(255)}${i}` });
    }
    const { pages } = await pageAll(orgId, { orderBy: ["name", "asc"], limit: 1 });
    expect(pages.map((p) => p.length)).toEqual([1, 1, 1]);
  });

  it("applies a where filter together with pagination", async () => {
    const orgId = newOrg();
    await seed(orgId, 25); // even index => open (13), odd => closed (12)
    await seed(newOrg(), 10);
    const { pages } = await pageAll(orgId, {
      where: [["status", "==", "open"]],
      orderBy: ["rank", "asc"],
      limit: 5,
    });
    const flat = pages.flat();
    expect(flat).toHaveLength(13);
    expect(flat.every((i) => i.status === "open" && i.organizationId === orgId)).toBe(true);
    expect(pages.map((p) => p.length)).toEqual([5, 5, 3]);
  });

  it("supports the `in` operator within limits", async () => {
    const orgId = newOrg();
    await seed(orgId, 6);
    const res = await repo.list(orgId, {
      where: [["rank", "in", [1, 3, 99]]],
      orderBy: ["rank", "asc"],
      limit: 10,
    });
    expect(res.items.map((i) => i.rank)).toEqual([1, 3]);
  });

  it("rejects `in` with an empty array, a non-array, or more than 30 values", async () => {
    const orgId = newOrg();
    await expectRejects(
      repo.list(orgId, { where: [["rank", "in", []]], orderBy: ["rank", "asc"], limit: 5 }),
      ValidationError,
    );
    const many = Array.from({ length: 31 }, (_, i) => i);
    await expectRejects(
      repo.list(orgId, { where: [["rank", "in", many]], orderBy: ["rank", "asc"], limit: 5 }),
      ValidationError,
    );
    await expectRejects(
      repo.list(orgId, { where: [["rank", "in", 5]], orderBy: ["rank", "asc"], limit: 5 }),
      ValidationError,
    );
    const ok = Array.from({ length: 30 }, (_, i) => i);
    await repo.list(orgId, { where: [["rank", "in", ok]], orderBy: ["rank", "asc"], limit: 5 });
  });

  it("rejects disallowed filter / sort fields and reports only the field name", async () => {
    const orgId = newOrg();
    const secret = "super-secret-value";
    for (const field of ["organizationId", "name", "id", "__name__", "nested.field"]) {
      const err = await expectRejects(
        repo.list(orgId, { where: [[field, "==", secret]], orderBy: ["rank", "asc"], limit: 5 }),
        ValidationError,
      );
      expect(JSON.stringify(err.details)).toContain(field);
      expect(JSON.stringify(err.details)).not.toContain(secret);
      expect(err.message).not.toContain(secret);
    }
    const err = await expectRejects(
      repo.list(orgId, { orderBy: ["status", "asc"], limit: 5 }),
      ValidationError,
    );
    expect(JSON.stringify(err.details)).toContain("status");
    await expectRejects(
      repo.list(orgId, { orderBy: ["rank", "sideways" as "asc"], limit: 5 }),
      ValidationError,
    );
    await expectRejects(
      repo.list(orgId, {
        where: [["status", "like" as "==", "x"]],
        orderBy: ["rank", "asc"],
        limit: 5,
      }),
      ValidationError,
    );
    await expectRejects(
      repo.list(orgId, { where: "nope" as never, orderBy: ["rank", "asc"], limit: 5 }),
      ValidationError,
    );
    await expectRejects(
      repo.list(orgId, { orderBy: undefined as never, limit: 5 }),
      ValidationError,
    );
  });

  it("validates limit as an integer in 1..100", async () => {
    const orgId = newOrg();
    for (const limit of [
      0,
      -1,
      101,
      Number.NaN,
      1.5,
      Infinity,
      "10" as unknown as number,
      undefined as unknown as number,
    ]) {
      await expectRejects(repo.list(orgId, { orderBy: ["rank", "asc"], limit }), ValidationError);
    }
    await repo.list(orgId, { orderBy: ["rank", "asc"], limit: 1 });
    await repo.list(orgId, { orderBy: ["rank", "asc"], limit: 100 });
  });

  it("rejects garbage cursors with ValidationError", async () => {
    const orgId = newOrg();
    await seed(orgId, 3);
    for (const cursor of [
      "garbage",
      "!!!",
      "e30",
      encodeCursor({ t: "ts", v: "not-a-date", id: "x" }),
      5 as unknown as string,
    ]) {
      await expectRejects(
        repo.list(orgId, { orderBy: ["rank", "asc"], limit: 5, cursor }),
        ValidationError,
      );
    }
  });

  it("a cursor from org A used on org B's list returns only org B docs", async () => {
    const [a, b] = [newOrg(), newOrg()];
    await seed(a, 8); // ranks 0..7
    const bIds = await seed(b, 8, (i) => 10 + i); // ranks 10..17: all sort after A's cursor position
    const pageA = await repo.list(a, { orderBy: ["rank", "asc"], limit: 3 });
    expect(pageA.nextCursor).not.toBeNull();
    const res = await repo.list(b, {
      orderBy: ["rank", "asc"],
      limit: 100,
      cursor: pageA.nextCursor!,
    });
    expect(res.items.map((i) => i.id)).toEqual(bIds); // exactly B's 8 docs, none of A's
  });

  it("a forged cursor cannot widen the query beyond the caller's org", async () => {
    const [a, b] = [newOrg(), newOrg()];
    const aIds = await seed(a, 5);
    const bItems = await seed(b, 5);
    // Position the cursor at the start of B's data but ask as A.
    const forged = encodeCursor({ t: "n", v: -1, id: bItems[0]! });
    const res = await repo.list(a, { orderBy: ["rank", "asc"], limit: 100, cursor: forged });
    expect(res.items.map((i) => i.id)).toEqual(aIds); // exactly A's 5 docs (all rank >= 0 > -1)
    // What the repo emits stays decodable.
    const page = await repo.list(a, { orderBy: ["rank", "asc"], limit: 2 });
    expect(decodeCursor(page.nextCursor).t).toBe("n");
  });

  it("serializes list timestamps as ISO strings", async () => {
    const orgId = newOrg();
    await seed(orgId, 2);
    const res = await repo.list(orgId, { orderBy: ["rank", "asc"], limit: 10 });
    for (const item of res.items) {
      expect(item.createdAt).toMatch(ISO);
      expect(item.updatedAt).toMatch(ISO);
    }
  });
});

describe("helpers for service transactions", () => {
  it("build() returns the payload create() would write, without writing", async () => {
    const orgId = newOrg();
    const built = repo.build(
      orgId,
      {
        name: "a",
        rank: 1,
        status: "open",
        organizationId: "org-evil",
        id: "evil",
        createdAt: "x",
        updatedAt: "y",
      } as NewItem,
      `built-${randomUUID()}`,
    );
    expect((await built.ref.get()).exists).toBe(false);
    expect(built.data.organizationId).toBe(orgId);
    expect("id" in built.data).toBe(false);
    expect(built.data.createdAt).not.toBe("x");

    const auto = repo.build(orgId, { name: "a", rank: 1, status: "open" } as NewItem);
    expect(auto.ref.id.length).toBeGreaterThan(0);
    expect(auto.ref.parent.id).toBe(COLLECTION);

    await adminDb().runTransaction(async (tx) => {
      tx.create(built.ref, built.data);
    });
    const created = await repo.create(orgId, { name: "a", rank: 1, status: "open" } as NewItem);
    const rawBuilt = (await built.ref.get()).data()!;
    const rawCreated = (await adminDb().collection(COLLECTION).doc(created.id).get()).data()!;
    expect(Object.keys(rawBuilt).sort()).toEqual(Object.keys(rawCreated).sort());
    expect(rawBuilt.createdAt).toBeInstanceOf(Timestamp);
    expect(await repo.get(orgId, built.ref.id)).toMatchObject({ name: "a", organizationId: orgId });
  });

  it("docRef() validates the id and points into the collection", () => {
    expect(repo.docRef("abc").path).toBe(`${COLLECTION}/abc`);
    expect(() => repo.docRef("a/b")).toThrow(ValidationError);
  });

  it("fromSnapshot() returns null for missing docs and optionally enforces the org", async () => {
    const orgId = newOrg();
    const created = await repo.create(orgId, { name: "a", rank: 1, status: "open" } as NewItem);
    const snap = await repo.docRef(created.id).get();
    expect(repo.fromSnapshot(snap, orgId)).toEqual(created);
    expect(repo.fromSnapshot(snap, newOrg())).toBeNull(); // cross-org snapshot
    // A missing/invalid org must never fail open.
    expect(() => repo.fromSnapshot(snap, undefined as never)).toThrow(ValidationError);
    expect(() => repo.fromSnapshot(snap, "" as never)).toThrow(ValidationError);
    expect(() => repo.fromSnapshot(snap, null as never)).toThrow(ValidationError);
    const missing = await repo.docRef(`missing-${randomUUID()}`).get();
    expect(repo.fromSnapshot(missing, orgId)).toBeNull();
    // Low-level variant: no tenant check by design.
    expect(repo.unsafeFromSnapshot(snap)).toEqual(created);
    expect(repo.unsafeFromSnapshot(missing)).toBeNull();
  });
});
