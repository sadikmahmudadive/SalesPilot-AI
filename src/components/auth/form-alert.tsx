import { CircleAlert } from "lucide-react";

/** Top-level form error banner. Always rendered as a live region so new messages are announced. */
export function FormAlert({ message, children }: { message?: string | null; children?: React.ReactNode }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p>{message}</p>
        {children}
      </div>
    </div>
  );
}
