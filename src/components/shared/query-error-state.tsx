import { CircleAlert, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";

interface QueryErrorStateProps {
  title: string;
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
}

/** Shared error panel for list and detail screens: message, request id (when the API sent one) and retry. */
export function QueryErrorState({ title, error, onRetry, retrying = false }: QueryErrorStateProps) {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  const message =
    error instanceof ApiError && error.code === "UNAUTHENTICATED"
      ? "Your session has expired. Reload the page to sign in again."
      : error instanceof Error
        ? error.message
        : "Something went wrong. Please try again.";

  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-10 text-center"
    >
      <CircleAlert className="size-6 text-destructive" aria-hidden="true" />
      <div className="space-y-1">
        <h2 className="text-base font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
        {requestId ? <p className="text-xs text-muted-foreground">Reference: {requestId}</p> : null}
      </div>
      <Button variant="outline" onClick={onRetry} disabled={retrying}>
        <RotateCw className={retrying ? "animate-spin" : undefined} aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
