"use client";

import { getClientEnv } from "@/config/env.client";
import { cn } from "@/lib/utils";

/** Environment indicator: "Emulator mode" when running against local Firebase emulators, otherwise "Live". */
export function StatusChip({ className }: { className?: string }) {
  const emulator = getClientEnv().NEXT_PUBLIC_USE_EMULATORS;
  return (
    <span
      role="status"
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border bg-background px-2.5 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", emulator ? "bg-amber-500" : "bg-emerald-500")}
      />
      {emulator ? "Emulator mode" : "Live"}
    </span>
  );
}
