import Image from "next/image";

import { cn } from "@/lib/utils";

export interface LogoProps {
  className?: string;
  priority?: boolean;
  size?: "sm" | "md" | "lg";
}

const SIZES = {
  sm: { height: 24, width: 105, className: "h-6 w-auto" },
  md: { height: 32, width: 140, className: "h-8 w-auto" },
  lg: { height: 40, width: 175, className: "h-10 w-auto" },
} as const;

/**
 * Responsive Brand Logo supporting Dark and Light modes.
 * - Light Mode: Displays the dark navy logo ("Sales Pilot AI dark.png")
 * - Dark Mode: Displays the white logo ("Sales Pilot AI light.png")
 */
export function Logo({ className, priority = false, size = "md" }: LogoProps) {
  const currentSize = SIZES[size];

  return (
    <div className={cn("relative inline-flex items-center", className)}>
      {/* Light theme: Dark text logo for light backgrounds */}
      <Image
        src="/logos/Sales Pilot AI dark.png"
        alt="SalesPilot AI"
        width={currentSize.width}
        height={currentSize.height}
        className={cn("block object-contain dark:hidden", currentSize.className)}
        priority={priority}
      />
      {/* Dark theme: White logo for dark backgrounds */}
      <Image
        src="/logos/Sales Pilot AI light.png"
        alt="SalesPilot AI"
        width={currentSize.width}
        height={currentSize.height}
        className={cn("hidden object-contain dark:block", currentSize.className)}
        priority={priority}
      />
    </div>
  );
}

/** Standard Brand presentation used in Auth layouts, Sidebar, and Mobile navigation. */
export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center", className)}>
      <Logo size="md" priority />
    </div>
  );
}
