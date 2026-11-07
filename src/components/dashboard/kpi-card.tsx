import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount } from "@/lib/format";

export type KpiState =
  /** A real number. */
  | { kind: "value"; value: number }
  /** The metric could not be loaded; no number is shown. */
  | { kind: "error" }
  /** The feature that produces this metric is built in a later phase; no number is shown. */
  | { kind: "later"; phase: number };

interface KpiCardProps {
  /** Unique within the page; used to label the region. */
  id: string;
  title: string;
  icon: LucideIcon;
  state: KpiState;
  /** One line under the value, e.g. what the number counts. */
  subtext?: string;
  /** List page this number comes from. Only used for real values and errors. */
  href?: string;
  linkLabel?: string;
}

/**
 * One overview tile: a labelled region with the title as its heading. Presentational: it never
 * fetches, and it never invents a number (an unavailable metric says so in words).
 */
export function KpiCard({ id, title, icon: Icon, state, subtext, href, linkLabel }: KpiCardProps) {
  const titleId = `${id}-title`;
  const detailId = `${id}-detail`;

  if (state.kind === "later") {
    return (
      <section aria-labelledby={titleId} className="h-full [&>[data-slot=card]]:h-full">
        <PlaceholderCard
          compact
          icon={Icon}
          badge={<Badge variant="secondary">Phase {state.phase}</Badge>}
          heading={title}
          headingId={titleId}
        >
          {subtext ? `${subtext} ` : null}Available after phase {state.phase}.
        </PlaceholderCard>
      </section>
    );
  }

  const failed = state.kind === "error";
  return (
    <section aria-labelledby={titleId} aria-describedby={failed ? detailId : undefined} className="h-full">
      <Card size="sm" className="h-full">
        <CardContent className="flex h-full flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id={titleId} className="text-sm font-medium text-muted-foreground">
              {title}
            </h2>
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>
          {failed ? (
            <div id={detailId}>
              <p className="text-lg font-semibold">Couldn&apos;t load</p>
              <p className="text-xs text-muted-foreground">
                The {title.toLowerCase()} figure is unavailable right now. Refresh the page to try again.
              </p>
            </div>
          ) : (
            <p className="text-3xl font-semibold tracking-tight tabular-nums">{formatCount(state.value)}</p>
          )}
          {subtext ? <p className="text-xs text-muted-foreground">{subtext}</p> : null}
          {href && linkLabel ? (
            <Button variant="link" size="sm" className="mt-auto h-auto justify-start p-0" asChild>
              <Link href={href}>{linkLabel}</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

/** Same footprint as a real KpiCard, shown while the counts stream in. Hidden from assistive tech. */
export function KpiCardSkeleton() {
  return (
    <Card size="sm" className="h-full" aria-hidden="true">
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-16" />
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-4 w-20" />
      </CardContent>
    </Card>
  );
}
