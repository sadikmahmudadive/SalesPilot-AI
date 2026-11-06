/**
 * Keeps a dialog open while a request it started is in flight. Closing mid-request would throw
 * away the outcome (and, for a non-idempotent action, let the user start a second one).
 * Pure: no React.
 */

interface Preventable {
  preventDefault: () => void;
}

/**
 * `onOpenChange` handler that ignores requests to close while `pending`. Opening is always allowed.
 */
export function guardOpenChange(pending: boolean, onOpenChange: (open: boolean) => void): (open: boolean) => void {
  return (open) => {
    if (!open && pending) return;
    onOpenChange(open);
  };
}

/**
 * Props for a Radix `Dialog.Content`: Escape and clicks outside do nothing while `pending`, and the
 * corner close button is hidden (`showCloseButton`).
 */
export function pendingDismissProps(pending: boolean) {
  const block = (event: Preventable) => {
    if (pending) event.preventDefault();
  };
  return { onEscapeKeyDown: block, onInteractOutside: block, showCloseButton: !pending };
}
