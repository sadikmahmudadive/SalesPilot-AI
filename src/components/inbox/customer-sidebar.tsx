"use client";

import Link from "next/link";
import { Copy, ExternalLink, Phone, ShoppingBag, User } from "lucide-react";
import { toast } from "sonner";

import { ChannelBadge, StatusBadge } from "@/components/inbox/conversation-card";
import { OrderStatusBadge } from "@/components/orders/order-badges";
import { Button } from "@/components/ui/button";
import { useCustomerOrders } from "@/hooks/use-orders";
import { formatMoneyMinor } from "@/lib/format";
import { initialsFor } from "@/lib/initials";
import type { Conversation } from "@/schemas/inbox";

/** The linked customer's latest orders. Not rendered for a conversation without a customer. */
function CustomerOrders({ customerId }: { customerId: string }) {
  const { data, isPending, isError } = useCustomerOrders(customerId);
  const orders = data?.items ?? [];

  return (
    <div className="space-y-3 pt-4 border-t border-border/60 text-xs">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
          Recent Orders
        </h4>
        {orders.length > 0 ? (
          <span className="text-[11px] text-muted-foreground tabular-nums">{orders.length}</span>
        ) : null}
      </div>

      {isPending ? (
        <p role="status" className="text-muted-foreground">
          Loading orders...
        </p>
      ) : isError ? (
        <p role="alert" className="text-muted-foreground">
          Couldn&apos;t load orders.
        </p>
      ) : orders.length === 0 ? (
        <p className="text-muted-foreground">No orders placed yet.</p>
      ) : (
        <ul className="space-y-2">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/orders/${encodeURIComponent(order.id)}`}
                className="block rounded-xl border border-border/60 bg-background p-2.5 space-y-1.5 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-xs text-foreground">
                    {order.orderNumber}
                  </span>
                  <OrderStatusBadge status={order.status} />
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {formatMoneyMinor(order.totalMinor)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CustomerSidebar({ conversation }: { conversation: Conversation | null }) {
  if (!conversation) return null;

  const initials = initialsFor(conversation.contactName, null);

  const handleCopyPhone = () => {
    void navigator.clipboard.writeText(conversation.contactPhoneE164);
    toast.success("Phone number copied");
  };

  return (
    <aside
      aria-label="Customer details"
      className="w-76 shrink-0 border-l border-border/60 bg-card flex flex-col h-full overflow-y-auto p-4 space-y-5"
    >
      {/* Profile Overview */}
      <div className="flex flex-col items-center text-center space-y-2 pt-1">
        <div className="size-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
          <span className="text-lg font-semibold text-primary">{initials}</span>
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">{conversation.contactName}</h3>
          <p className="text-xs text-muted-foreground tabular-nums">
            {conversation.contactPhoneE164}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5">
          <ChannelBadge channel={conversation.channel} />
          <StatusBadge status={conversation.status} />
        </div>
      </div>

      {/* Contact Details */}
      <div className="space-y-3 pt-4 border-t border-border/60 text-xs">
        <h4 className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
          Contact Information
        </h4>

        <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background px-3 py-2">
          <div className="flex items-center gap-2 min-w-0 text-foreground">
            <Phone className="size-3.5 text-muted-foreground shrink-0" />
            <span className="truncate tabular-nums">{conversation.contactPhoneE164}</span>
          </div>
          <button
            type="button"
            onClick={handleCopyPhone}
            aria-label="Copy phone number"
            className="text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
          >
            <Copy className="size-3.5" />
          </button>
        </div>

        <a
          href={`https://wa.me/${conversation.contactPhoneE164.replace(/\D/g, "")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
        >
          Open in WhatsApp Web
          <ExternalLink className="size-3" />
        </a>
      </div>

      {/* Orders of the linked customer */}
      {conversation.customerId ? <CustomerOrders customerId={conversation.customerId} /> : null}

      {/* Quick Actions */}
      <div className="space-y-2 pt-4 border-t border-border/60">
        <h4 className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px] mb-2">
          Quick Actions
        </h4>
        <Button asChild variant="outline" size="sm" className="w-full justify-start text-xs gap-2">
          <Link
            href={
              conversation.customerId
                ? `/customers/${encodeURIComponent(conversation.customerId)}`
                : "/customers"
            }
          >
            <User className="size-3.5" />
            {conversation.customerId ? "View customer profile" : "Open CRM directory"}
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="w-full justify-start text-xs gap-2">
          <Link href="/orders/new">
            <ShoppingBag className="size-3.5" />
            Create order
          </Link>
        </Button>
      </div>
    </aside>
  );
}
