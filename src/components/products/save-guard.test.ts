import { describe, expect, it } from "vitest";

import { saveGuard } from "./save-guard";

describe("saveGuard", () => {
  it("allows saving and has no hint when idle", () => {
    expect(saveGuard({ dirty: false, canWrite: true, uploading: false })).toEqual({
      canSave: true,
      hasUnsavedWork: false,
      hint: null,
    });
  });

  it("warns about leaving when the form is dirty", () => {
    expect(saveGuard({ dirty: true, canWrite: true, uploading: false })).toMatchObject({
      canSave: true,
      hasUnsavedWork: true,
    });
  });

  it("blocks saving while an upload is running, hints, and counts it as unsaved work even on a clean form", () => {
    const guard = saveGuard({ dirty: false, canWrite: true, uploading: true });
    expect(guard.canSave).toBe(false);
    expect(guard.hasUnsavedWork).toBe(true);
    expect(guard.hint).toBe("Wait for uploads to finish");
  });

  it("never warns or hints for people without write access", () => {
    expect(saveGuard({ dirty: true, canWrite: false, uploading: true })).toEqual({
      canSave: false,
      hasUnsavedWork: false,
      hint: null,
    });
  });
});
