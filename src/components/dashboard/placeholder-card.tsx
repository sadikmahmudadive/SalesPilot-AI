import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

interface PlaceholderCardProps {
  icon: LucideIcon;
  /** Optional element above the text (e.g. a phase badge). */
  badge?: React.ReactNode;
  /** Optional `h2` shown above the body text. */
  heading?: string;
  children: React.ReactNode;
}

/** Dashed, centred card shared by every not-yet-built page (ComingLater and the temporary stubs). */
export function PlaceholderCard({ icon: Icon, badge, heading, children }: PlaceholderCardProps) {
  return (
    <Card className="border border-dashed shadow-none ring-0">
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center sm:py-16">
        <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        {badge}
        <div className="max-w-md space-y-2">
          {heading && <h2 className="text-base font-medium">{heading}</h2>}
          <p className="text-sm text-muted-foreground">{children}</p>
        </div>
      </CardContent>
    </Card>
  );
}
