import { CircleAlert } from "lucide-react";

/**
 * Top-level form error banner. The `role="alert"` container is always mounted (and empty when
 * there is no error) so screen readers reliably announce messages that appear later. The
 * banner carries its own bottom margin, so an empty container takes no space.
 */
export function FormAlert({
  message,
  children,
  ref,
}: {
  message?: string | null;
  children?: React.ReactNode;
  /** Lets a long form scroll to the banner and focus it (see `useRevealAlert`). */
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div role="alert" ref={ref} tabIndex={-1} className="outline-none">
      {message ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p>{message}</p>
            {children}
          </div>
        </div>
      ) : null}
    </div>
  );
}
