import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { ValidationError } from "@/lib/errors";

// Pure path logic only: a stand-in Firestore that builds document paths without any SDK or env.
vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => ({
    collection: (name: string) => ({ doc: (id?: string) => ({ path: `${name}/${id ?? "auto"}` }) }),
  }),
}));

import {
  ORDERS,
  ORDER_COUNTERS,
  ORDER_EVENTS,
  ORDER_IDEMPOTENCY,
  ORDER_NUMBERS,
  ORDER_SETTINGS,
  counterRef,
  formatOrderNumber,
  idempotencyRef,
  orderEventRepo,
  orderNumberRef,
  orderRepo,
  settingsRef,
} from "./orders";

describe("formatOrderNumber", () => {
  it("zero-pads to six digits", () => {
    expect(formatOrderNumber(1)).toBe("SP-000001");
    expect(formatOrderNumber(123)).toBe("SP-000123");
    expect(formatOrderNumber(999999)).toBe("SP-999999");
  });
  it("grows past 999999 without truncation", () => {
    expect(formatOrderNumber(1000000)).toBe("SP-1000000");
    expect(formatOrderNumber(1234567)).toBe("SP-1234567");
  });
  it("rejects non-positive or non-integer numbers", () => {
    for (const n of [0, -1, 1.5, Number.NaN]) expect(() => formatOrderNumber(n)).toThrow();
  });
});

describe("collection names and refs", () => {
  it("uses the documented collections and ids", () => {
    expect([ORDERS, ORDER_EVENTS, ORDER_COUNTERS, ORDER_NUMBERS, ORDER_IDEMPOTENCY]).toEqual([
      "orders",
      "orderEvents",
      "orderCounters",
      "orderNumbers",
      "orderIdempotency",
    ]);
    expect(ORDER_SETTINGS).toBe("orderSettings");
    expect(counterRef("org1").path).toBe("orderCounters/org1");
    expect(settingsRef("org1").path).toBe("orderSettings/org1");
    expect(orderNumberRef("org1", "SP-000001").path).toBe("orderNumbers/org1_SP-000001");
  });

  it("idempotency ref hashes the key (sha256 hex, first 40 chars)", () => {
    const key = "abc-12345678";
    const hex = createHash("sha256").update(key).digest("hex").slice(0, 40);
    expect(idempotencyRef("org1", key).path).toBe(`orderIdempotency/org1_${hex}`);
    expect(idempotencyRef("org1", key).path).not.toBe(idempotencyRef("org2", key).path);
  });

  it("rejects invalid org ids instead of building a path", () => {
    expect(() => counterRef("a/b")).toThrow(ValidationError);
    expect(() => settingsRef("")).toThrow(ValidationError);
    expect(() => orderNumberRef("a/b", "SP-000001")).toThrow(ValidationError);
    expect(() => idempotencyRef("", "k")).toThrow(ValidationError);
  });
});

describe("repositories", () => {
  it("are OrgRepositories over the right collections", () => {
    expect(orderRepo.docRef("x").path).toBe("orders/x");
    expect(orderEventRepo.docRef("x").path).toBe("orderEvents/x");
  });
});
