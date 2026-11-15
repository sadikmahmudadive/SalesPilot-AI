import { beforeEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "@/lib/errors";

const runTransaction = vi.fn();
const fakeDoc = (id: string) => ({ id, collection: () => ({ doc: fakeDoc }) });

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => ({ runTransaction, collection: () => ({ doc: fakeDoc }) }),
}));

import {
  ADJUST_MAX_ATTEMPTS,
  RESERVATION_MAX_ATTEMPTS,
  adjustStock,
  commitStock,
  releaseStock,
  reserveStock,
} from "./stock";

/** Resolves/rejects without touching Firestore: only the options handed to the SDK matter here. */
const STOP = new Error("stop: transaction runner reached");

const ctx = { organizationId: "org1", uid: "u1" };
const callers = {
  reserve: (options?: { maxAttempts?: number }) =>
    reserveStock("org1", "p1", "default", 1, "key1", options),
  release: (options?: { maxAttempts?: number }) =>
    releaseStock("org1", "p1", "default", "key1", options),
  commit: (options?: { maxAttempts?: number }) =>
    commitStock("org1", "p1", "default", "key1", options),
  adjust: (options?: { maxAttempts?: number }) =>
    adjustStock(ctx, "p1", "default", { delta: 1, reason: "count" }, options),
};

beforeEach(() => {
  runTransaction.mockReset();
  runTransaction.mockRejectedValue(STOP);
});

describe.each([
  ["reserve", callers.reserve, RESERVATION_MAX_ATTEMPTS],
  ["release", callers.release, RESERVATION_MAX_ATTEMPTS],
  ["commit", callers.commit, RESERVATION_MAX_ATTEMPTS],
  ["adjust", callers.adjust, ADJUST_MAX_ATTEMPTS],
] as const)("%s maxAttempts option", (_name, call, max) => {
  it(`defaults to ${max}`, async () => {
    await expect(call()).rejects.toBe(STOP);
    expect(runTransaction).toHaveBeenCalledWith(expect.any(Function), { maxAttempts: max });
    runTransaction.mockClear();
    await expect(call({})).rejects.toBe(STOP);
    expect(runTransaction).toHaveBeenCalledWith(expect.any(Function), { maxAttempts: max });
  });

  it("passes a valid value to runTransaction", async () => {
    for (const value of [1, 3, max]) {
      runTransaction.mockClear();
      await expect(call({ maxAttempts: value })).rejects.toBe(STOP);
      expect(runTransaction).toHaveBeenCalledWith(expect.any(Function), { maxAttempts: value });
    }
  });

  it.each([0, -1, max + 1, 100, 2.5, Number.NaN, Infinity, "3" as unknown as number])(
    "rejects %s with a ValidationError before touching Firestore",
    async (bad) => {
      const err = await call({ maxAttempts: bad }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).details?.[0]?.path).toBe("options.maxAttempts");
      expect(runTransaction).not.toHaveBeenCalled();
    },
  );
});
