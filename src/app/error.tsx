"use client"; // Error boundaries must be Client Components

import { RouteError } from "@/components/shared/route-error";

/**
 * Catches errors outside the dashboard pages' own boundary, notably the dashboard layout itself
 * (an error.tsx never wraps the layout of its own segment), e.g. when Firebase Auth is unreachable.
 */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <RouteError error={error} retry={retry} />
    </main>
  );
}
