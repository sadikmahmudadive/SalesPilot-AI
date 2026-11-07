import { describe, expect, it } from "vitest";

import { plannedDeletes } from "./planned-deletes";

const base = { baseline: [], saved: null, sessionUploads: [], removedBeforeSave: [] } as const;

describe("plannedDeletes", () => {
  it("does nothing when nothing was removed", () => {
    expect(plannedDeletes({ ...base })).toEqual({ immediate: [], afterSave: [] });
  });

  it("deletes an image uploaded this session and removed before saving, immediately", () => {
    expect(plannedDeletes({ ...base, sessionUploads: ["n1"], removedBeforeSave: ["n1"] })).toEqual({
      immediate: ["n1"],
      afterSave: [],
    });
  });

  it("deletes every removed image immediately for a new product (empty baseline)", () => {
    const result = plannedDeletes({ ...base, sessionUploads: ["a", "b"], removedBeforeSave: ["a", "b"] });
    expect(result.immediate).toEqual(["a", "b"]);
  });

  it("never deletes a removed baseline image before the save", () => {
    const result = plannedDeletes({ ...base, baseline: ["old1", "old2"], removedBeforeSave: ["old1"] });
    expect(result).toEqual({ immediate: [], afterSave: [] });
  });

  it("after a successful save, deletes baseline images that are no longer saved", () => {
    const result = plannedDeletes({ ...base, baseline: ["old1", "old2"], saved: ["old2"], removedBeforeSave: ["old1"] });
    expect(result).toEqual({ immediate: [], afterSave: ["old1"] });
  });

  it("keeps baseline images that are still saved", () => {
    expect(plannedDeletes({ ...base, baseline: ["a", "b"], saved: ["a", "b", "c"] }).afterSave).toEqual([]);
  });

  it("treats a session upload that was saved earlier (now in the baseline) as a baseline image", () => {
    const removed = plannedDeletes({ ...base, baseline: ["s1"], sessionUploads: ["s1"], removedBeforeSave: ["s1"] });
    expect(removed).toEqual({ immediate: [], afterSave: [] });
    const saved = plannedDeletes({ ...base, baseline: ["s1"], sessionUploads: ["s1"], saved: [], removedBeforeSave: ["s1"] });
    expect(saved).toEqual({ immediate: [], afterSave: ["s1"] });
  });

  it("never deletes an image that is still referenced by the saved product", () => {
    const result = plannedDeletes({ ...base, baseline: ["a"], sessionUploads: ["n"], saved: ["a", "n"], removedBeforeSave: ["n"] });
    expect(result).toEqual({ immediate: [], afterSave: [] });
  });

  it("ignores removed ids that are neither uploaded this session nor in the baseline", () => {
    expect(plannedDeletes({ ...base, removedBeforeSave: ["stranger"] })).toEqual({ immediate: [], afterSave: [] });
  });

  it("de-duplicates", () => {
    const result = plannedDeletes({ ...base, sessionUploads: ["n", "n"], removedBeforeSave: ["n", "n"] });
    expect(result.immediate).toEqual(["n"]);
    expect(plannedDeletes({ ...base, baseline: ["a", "a"], saved: [] }).afterSave).toEqual(["a"]);
  });
});
