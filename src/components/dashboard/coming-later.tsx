import { Clock, type LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface ComingLaterProps {
  /** Roadmap phase that delivers this page. */
  phase: number;
  title: string;
  /** What will live here. Plain description; never fake data. */
  description?: string;
  /** Optional icon shown in the card (defaults to a clock). */
  icon?: LucideIcon;
}

/** Honest placeholder for sections that are built in a later phase. Renders the page's `h1`. */
export function ComingLater({ phase, title, description, icon: Icon = Clock }: ComingLaterProps) {
  return (
    <div>
      <PageHeader title={title} />
      <Card className="border border-dashed shadow-none ring-0">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center sm:py-16">
          <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <Badge variant="secondary">Coming in phase {phase}</Badge>
          <div className="max-w-md space-y-2">
            <h2 className="text-base font-medium">{title} is not available yet</h2>
            <p className="text-sm text-muted-foreground">
              {description ?? `This section will be available in phase ${phase} of the roadmap.`} Nothing is shown
              here until it works with your real data.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
