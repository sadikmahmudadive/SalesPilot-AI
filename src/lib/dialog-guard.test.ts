import { describe, expect, it, vi } from "vitest";

import { guardOpenChange, pendingDismissProps } from "@/lib/dialog-guard";

describe("guardOpenChange", () => {
  it("ignores close requests while pending", () => {
    const onOpenChange = vi.fn();
    guardOpenChange(true, onOpenChange)(false);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("passes close requests through when idle, and open requests always", () => {
    const onOpenChange = vi.fn();
    guardOpenChange(false, onOpenChange)(false);
    guardOpenChange(true, onOpenChange)(true);
    expect(onOpenChange.mock.calls).toEqual([[false], [true]]);
  });
});

describe("pendingDismissProps", () => {
  it("blocks Escape and outside clicks and hides the close button while pending", () => {
    const props = pendingDismissProps(true);
    const escape = { preventDefault: vi.fn() };
    const outside = { preventDefault: vi.fn() };
    props.onEscapeKeyDown(escape);
    props.onInteractOutside(outside);
    expect(escape.preventDefault).toHaveBeenCalledTimes(1);
    expect(outside.preventDefault).toHaveBeenCalledTimes(1);
    expect(props.showCloseButton).toBe(false);
  });

  it("leaves every dismissal path alone when idle", () => {
    const props = pendingDismissProps(false);
    const escape = { preventDefault: vi.fn() };
    props.onEscapeKeyDown(escape);
    props.onInteractOutside(escape);
    expect(escape.preventDefault).not.toHaveBeenCalled();
    expect(props.showCloseButton).toBe(true);
  });
});
