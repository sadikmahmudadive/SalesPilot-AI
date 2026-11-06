"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Client providers for the signed-in area. ThemeProvider and Toaster already live in the root
 * layout (`src/app/providers.tsx`), so only data fetching and tooltips are added here.
 *
 * The QueryClient is created once per mounted dashboard (the layout persists across navigations);
 * a full page load, including after sign-in as another user, starts with an empty cache.
 */
export function DashboardProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
