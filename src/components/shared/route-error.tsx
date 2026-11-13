"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CircleAlert, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/** `digest` is the server-log correlation id Next attaches to errors from Server Components. */
export function errorDigest(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.length > 0 ? digest : undefined;
}

interface RouteErrorProps {
  error: unknown;
  /** Next's `retry`: re-fetches and re-renders the failed segment. */
  retry: () => void;
}

/**
 * Fallback UI for `error.tsx` boundaries. Shows a friendly message and, when present, the digest as
 * a support reference. The raw error message is never rendered (in production it is a generic
 * placeholder, in development it could be sensitive or noisy).
 */
export function RouteError({ error, retry }: RouteErrorProps) {
  const digest = errorDigest(error);

  useEffect(() => {
    // Surfaces in the browser console / any client error reporter; the user never sees it.
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center"
    >
      <CircleAlert className="size-8 text-destructive" aria-hidden="true" />
      <div className="space-y-1">
        <h2 className="text-lg font-medium">Something went wrong loading this page</h2>
        <p className="text-sm text-muted-foreground">
          This is usually temporary. Try again, or head back to your dashboard.
        </p>
        {digest ? <p className="text-xs text-muted-foreground">Reference: {digest}</p> : null}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={() => retry()}>
          <RotateCw aria-hidden="true" />
          Retry
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
