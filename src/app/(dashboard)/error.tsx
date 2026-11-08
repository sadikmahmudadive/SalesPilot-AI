"use client"; // Error boundaries must be Client Components

import { RouteError } from "@/components/shared/route-error";

/** Catches errors thrown by dashboard pages; the shell (sidebar, header) stays on screen. */
export default function DashboardError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="p-4 sm:p-6">
      <RouteError error={error} retry={retry} />
    </div>
  );
}
