import { cn } from "@/lib/utils";

export interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  variant?: "lockup" | "icon" | "wordmark";
}

const SIZES = {
  sm: {
    iconSize: "size-7 rounded-[6px] text-[20px] pb-[2.5px]",
    textClass: "text-lg tracking-[-0.045em]",
    gapClass: "gap-2",
  },
  md: {
    iconSize: "size-8.5 rounded-[8px] text-[24px] pb-[3px]",
    textClass: "text-xl tracking-[-0.045em]",
    gapClass: "gap-2.5",
  },
  lg: {
    iconSize: "size-11 rounded-[10px] text-[30px] pb-[4px]",
    textClass: "text-2xl tracking-[-0.045em]",
    gapClass: "gap-3",
  },
} as const;

/**
 * App Icon ("s." mark) from Turn 2 of the SalesPilot AI Typography Logo Design System.
 * Colours come from the brand tokens in `globals.css` (`--brand*`):
 * - Background: `bg-brand` (green in both modes)
 * - Letter "s": `text-brand-foreground` (white)
 * - Accent dot ".": `text-brand-ink` (dark neutral in light mode, mint in dark mode).
 */
export function BrandMark({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const current = SIZES[size];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center font-[family-name:var(--font-manrope)] font-extrabold leading-none tracking-[-0.06em] select-none bg-brand text-brand-foreground shadow-xs transition-colors",
        current.iconSize,
        className,
      )}
    >
      s<span className="text-brand-ink">.</span>
    </span>
  );
}

/**
 * Wordmark ("salespilot.ai") from the Typography Logo Design System.
 * - "salespilot": `text-brand-wordmark` (dark in light mode, white in dark mode).
 * - ".ai": `text-brand-accent` (brand green in light mode, mint in dark mode).
 * The visual text is hidden from assistive tech and replaced by one readable name.
 */
export function BrandWordmark({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const current = SIZES[size];
  return (
    <span
      className={cn(
        "font-[family-name:var(--font-manrope)] font-extrabold leading-none select-none text-brand-wordmark transition-colors",
        current.textClass,
        className,
      )}
    >
      <span aria-hidden="true">
        salespilot<span className="text-brand-accent">.ai</span>
      </span>
      <span className="sr-only">SalesPilot AI</span>
    </span>
  );
}

/**
 * Full SalesPilot AI Brand Logo Lockup (Turn 2c: Icon + Wordmark).
 * Pure scalable CSS & typography from the logo design system.
 */
export function Logo({ size = "md", variant = "lockup", className }: LogoProps) {
  const current = SIZES[size];

  if (variant === "icon") {
    return <BrandMark size={size} className={className} />;
  }

  if (variant === "wordmark") {
    return <BrandWordmark size={size} className={className} />;
  }

  return (
    <div className={cn("inline-flex items-center", current.gapClass, className)}>
      <BrandMark size={size} />
      <BrandWordmark size={size} />
    </div>
  );
}

/**
 * Standard brand logo for website header, sidebar, mobile navigation and auth shell.
 */
export function Brand({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <div className={cn("inline-flex items-center", className)}>
      <Logo size={size} variant="lockup" />
    </div>
  );
}
