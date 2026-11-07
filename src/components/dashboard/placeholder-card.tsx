import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface PlaceholderCardProps {
  icon: LucideIcon;
  /** Optional element above the text (e.g. a phase badge). */
  badge?: React.ReactNode;
  /** Optional `h2` shown above the body text. */
  heading?: string;
  /** `id` for the heading, so a wrapping region can name itself with `aria-labelledby`. */
  headingId?: string;
  /** Tighter padding and a left-aligned layout for use inside a grid of cards (e.g. the overview). */
  compact?: boolean;
  children: React.ReactNode;
}

/** Dashed, centred card shared by every not-yet-built page (ComingLater and the temporary stubs). */
export function PlaceholderCard({
  icon: Icon,
  badge,
  heading,
  headingId,
  compact = false,
  children,
}: PlaceholderCardProps) {
  return (
    <Card className="border border-dashed shadow-none ring-0">
      <CardContent
        className={cn(
          "flex flex-col gap-4",
          compact ? "items-start py-2 text-left" : "items-center py-12 text-center sm:py-16",
        )}
      >
        <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        {badge}
        <div className={cn("space-y-2", !compact && "max-w-md")}>
          {heading && (
            <h2 id={headingId} className="text-base font-medium">
              {heading}
            </h2>
          )}
          <p className="text-sm text-muted-foreground">{children}</p>
        </div>
      </CardContent>
    </Card>
  );
}
