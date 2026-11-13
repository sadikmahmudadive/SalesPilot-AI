"use client";

import { QueryErrorState } from "@/components/shared/query-error-state";
import { SectionCard } from "@/components/shared/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, reasonText } from "@/config/order-labels";
import { useOrderEvents } from "@/hooks/use-orders";
import { formatDateTime } from "@/lib/format";
import type { OrderEvent } from "@/schemas/order";

const ACTORS: Record<OrderEvent["actor"]["kind"], string> = {
  ai: "AI agent",
  user: "Team member",
  system: "System",
};

const TYPE_LABELS: Record<OrderEvent["type"], string> = {
  created: "Order created",
  updated: "Order edited",
  status_changed: "Status changed",
  stock_released: "Stock released",
  stock_committed: "Stock taken out",
  refund_recorded: "Refund recorded",
  note: "Note",
  payment_link_sent: "Payment link sent",
  payment_attempt: "Payment attempt",
  payment_confirmed: "Payment confirmed",
  payment_failed: "Payment failed",
  courier_booked: "Courier booked",
  courier_status: "Courier update",
};

/** "Confirmed to Processing" for a status or payment change; unknown values are shown as they are. */
function transitionText(event: OrderEvent): string | null {
  if (!event.from && !event.to) return null;
  const label = (v: string | null) =>
    v === null
      ? null
      : ((ORDER_STATUS_LABELS as Record<string, string>)[v] ??
        (PAYMENT_STATUS_LABELS as Record<string, string>)[v] ??
        v);
  const from = label(event.from);
  const to = label(event.to);
  return from && to ? `${from} to ${to}` : (to ?? from);
}

/** Everything that happened to the order, oldest first. All text is rendered as text (never as markup). */
export function OrderTimeline({ id }: { id: string }) {
  const query = useOrderEvents(id);

  return (
    <SectionCard title="Timeline">
      {query.isPending ? (
        <div aria-hidden="true" className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : query.isError ? (
        <QueryErrorState
          title="The timeline could not be loaded"
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : query.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has happened to this order yet.</p>
      ) : (
        <ol className="space-y-4">
          {query.data.items.map((event) => {
            const change = transitionText(event);
            return (
              <li key={event.id} className="border-l-2 pl-4">
                <p className="text-sm font-medium">
                  {TYPE_LABELS[event.type]}
                  {change ? (
                    <span className="font-normal text-muted-foreground">: {change}</span>
                  ) : null}
                </p>
                {event.detail ? (
                  <p className="text-sm text-muted-foreground">{reasonText(event.detail)}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {ACTORS[event.actor.kind]} · {formatDateTime(event.createdAt)}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}
