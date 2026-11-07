import { describe, expect, it } from "vitest";

import { focusAfterRemove } from "./focus-after-remove";

describe("focusAfterRemove", () => {
  it("focuses the next image, which now sits at the removed index", () => {
    expect(focusAfterRemove(3, 0)).toBe(0);
    expect(focusAfterRemove(3, 1)).toBe(1);
  });
  it("focuses the previous image when the last one was removed", () => {
    expect(focusAfterRemove(3, 2)).toBe(1);
    expect(focusAfterRemove(2, 1)).toBe(0);
  });
  it("hands focus to the uploader when no image remains", () => {
    expect(focusAfterRemove(1, 0)).toBe("uploader");
  });
  it("hands focus to the uploader for an out-of-range index", () => {
    expect(focusAfterRemove(2, 5)).toBe("uploader");
    expect(focusAfterRemove(2, -1)).toBe("uploader");
    expect(focusAfterRemove(0, 0)).toBe("uploader");
  });
});
