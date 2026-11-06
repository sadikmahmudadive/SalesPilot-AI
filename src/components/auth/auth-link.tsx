import Link from "next/link";

import { cn } from "@/lib/utils";

/** Inline text link with the auth pages' shared underline and focus-ring treatment. */
export function AuthLink({ className, ...props }: React.ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        "rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}
