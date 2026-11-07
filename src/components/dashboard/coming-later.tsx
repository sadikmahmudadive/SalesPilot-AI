import { Clock, type LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import { Badge } from "@/components/ui/badge";

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
export function ComingLater({ phase, title, description, icon = Clock }: ComingLaterProps) {
  return (
    <div>
      <PageHeader title={title} />
      <PlaceholderCard
        icon={icon}
        badge={<Badge variant="secondary">Coming in phase {phase}</Badge>}
        heading={`${title} is not available yet`}
      >
        {description ?? `This section will be available in phase ${phase} of the roadmap.`} Nothing
        is shown here until it works with your real data.
      </PlaceholderCard>
    </div>
  );
}
