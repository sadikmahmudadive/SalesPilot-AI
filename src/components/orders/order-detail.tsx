"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, ExternalLink, Link2, Loader2, ShoppingCart, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import { ActionBar } from "@/components/orders/action-bar";
import {
  ExpiredBadge,
  OrderStatusBadge,
  PaymentStatusBadge,
} from "@/components/orders/order-badges";
import { OrderForm } from "@/components/orders/order-form";
import { OrderTimeline } from "@/components/orders/order-timeline";
import { BackLink } from "@/components/shared/back-link";
import { QueryErrorState } from "@/components/shared/query-error-state";
import { SectionCard } from "@/components/shared/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { reasonText } from "@/config/order-labels";
import { useOrder, type OrderDetail as OrderDetailData } from "@/hooks/use-orders";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, formatMoneyMinor } from "@/lib/format";
import { can, type Role } from "@/lib/security/permissions";

const ZONE_LABELS = { inside_dhaka: "Inside Dhaka", outside_dhaka: "Outside Dhaka" } as const;
const METHOD_LABELS = { cod: "Cash on delivery", online: "Online payment" } as const;

function DetailSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-words">{children}</dd>
    </div>
  );
}

function LinesCard({ order }: { order: OrderDetailData }) {
  const totals: Array<[string, string]> = [
    ["Subtotal", formatMoneyMinor(order.subtotalMinor)],
    ["Discount", `-${formatMoneyMinor(order.discountMinor)}`],
    ["Delivery", formatMoneyMinor(order.deliveryChargeMinor)],
  ];
  return (
    <SectionCard title="Lines and totals">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Item</TableHead>
            <TableHead scope="col" className="text-right">
              Price
            </TableHead>
            <TableHead scope="col" className="text-right">
              Qty
            </TableHead>
            <TableHead scope="col" className="text-right">
              Total
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {order.lines.map((line) => (
            <TableRow key={line.holdKey}>
              <TableCell className="max-w-64 whitespace-normal">
                <div className="font-medium">{line.productName}</div>
                <div className="text-xs text-muted-foreground">
                  {[line.variantLabel, line.sku].filter(Boolean).join(" · ")}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoneyMinor(line.unitPriceMinor)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoneyMinor(line.lineTotalMinor)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <dl className="mt-4 ml-auto max-w-xs space-y-1.5 text-sm">
        {totals.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t pt-2 text-base font-medium">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoneyMinor(order.totalMinor)}</dd>
        </div>
      </dl>
    </SectionCard>
  );
}

function CustomerCard({ order }: { order: OrderDetailData }) {
  const a = order.shippingAddress;
  const place = [a.area, a.district].filter(Boolean).join(", ");
  return (
    <SectionCard title="Customer and delivery">
      <dl className="space-y-2">
        <Row label="Customer">
          <Link
            href={`/customers/${encodeURIComponent(order.customerId)}`}
            className="underline-offset-4 hover:underline"
          >
            {order.customerSnapshot.name}
          </Link>
        </Row>
        <Row label="Deliver to">{a.recipientName}</Row>
        <Row label="Phone">
          <span className="tabular-nums">{a.phone}</span>
        </Row>
        <Row label="Address">
          {a.line1}
          {place ? <span className="block text-muted-foreground">{place}</span> : null}
        </Row>
        <Row label="Zone">{ZONE_LABELS[a.zone]}</Row>
        {a.note ? <Row label="Delivery note">{a.note}</Row> : null}
        {order.notes ? <Row label="Internal notes">{order.notes}</Row> : null}
      </dl>
    </SectionCard>
  );
}

function PaymentCard({ order }: { order: OrderDetailData }) {
  const [generating, setGenerating] = useState(false);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);

  const holding =
    order.holdExpiresAt !== null &&
    (order.status === "draft" || order.paymentStatus === "awaiting_payment");

  const canGenerate =
    order.paymentMethod === "online" &&
    order.status === "confirmed" &&
    (order.paymentStatus === "awaiting_payment" || order.paymentStatus === "failed");

  const handleGenerateLink = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/payment-link`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to create payment link");
      setPaymentLink(json.data.url);
      await navigator.clipboard.writeText(json.data.url);
      toast.success("Payment link generated and copied to clipboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate link");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!paymentLink) return;
    await navigator.clipboard.writeText(paymentLink);
    toast.success("Payment link copied to clipboard");
  };

  return (
    <SectionCard title="Payment">
      <dl className="space-y-2">
        <Row label="Method">{METHOD_LABELS[order.paymentMethod]}</Row>
        <Row label="Status">
          <PaymentStatusBadge status={order.paymentStatus} />
        </Row>
        {holding ? (
          <Row label={order.expired ? "Hold expired" : "Hold expires"}>
            {formatDateTime(order.holdExpiresAt)}
          </Row>
        ) : null}
        {order.allowUnpaidReason ? (
          <Row label="Processed unpaid because">{order.allowUnpaidReason}</Row>
        ) : null}
        {order.refund ? (
          <>
            <Row label="Refund reason">{order.refund.reason}</Row>
            <Row label="Refunded">{formatDateTime(order.refund.at)}</Row>
          </>
        ) : null}
        {order.status === "cancelled" ? (
          <>
            {order.cancelReason ? (
              <Row label="Cancelled because">{reasonText(order.cancelReason)}</Row>
            ) : null}
            <Row label="Cancelled">{formatDateTime(order.cancelledAt)}</Row>
          </>
        ) : null}
      </dl>

      {order.paymentMethod === "online" ? (
        <div className="mt-4 pt-3 border-t border-border/40 space-y-2.5">
          {order.paymentStatus === "paid" ? (
            <p className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Payment settled online.
            </p>
          ) : canGenerate ? (
            <div className="space-y-2">
              {paymentLink ? (
                <div className="p-3 rounded-xl bg-muted/50 border border-border/50 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">Active Payment Link</span>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="inline-flex items-center gap-1 text-primary hover:underline font-medium cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </button>
                  </div>
                  <p className="text-xs font-mono text-muted-foreground break-all bg-background p-2 rounded-lg border">
                    {paymentLink}
                  </p>
                  <a
                    href={paymentLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="w-3 h-3" /> Open checkout page
                  </a>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleGenerateLink}
                  disabled={generating}
                  className="w-full py-2.5 px-3 rounded-xl bg-primary text-primary-foreground text-xs font-semibold shadow hover:bg-primary/90 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {generating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Link2 className="w-3.5 h-3.5" />
                  )}
                  Generate Customer Payment Link
                </button>
              )}
            </div>
          ) : (
            <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Payment link generation is available once the order is confirmed.
            </p>
          )}
        </div>
      ) : null}
    </SectionCard>
  );
}

/** The order page body: loads one order and shows its cards, actions (writers only) and timeline. */
export function OrderDetailView({ id, role }: { id: string; role: Role }) {
  const canWrite = can(role, "orders:write");
  const query = useOrder(id);
  const [editing, setEditing] = useState(false);
  const order = query.data;

  if (query.isPending) {
    return (
      <div>
        <BackLink href="/orders">All orders</BackLink>
        <p className="sr-only" role="status">
          Loading order
        </p>
        <DetailSkeleton />
      </div>
    );
  }

  if (!order) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div>
        <BackLink href="/orders">All orders</BackLink>
        {notFound ? (
          <PlaceholderCard icon={ShoppingCart} heading="Order not found">
            This order may not exist, or the link is incorrect.
          </PlaceholderCard>
        ) : (
          <QueryErrorState
            title="This order could not be loaded"
            error={query.error}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        )}
      </div>
    );
  }

  const canEdit = canWrite && order.status === "draft" && !order.expired;
  if (editing && canEdit) {
    return (
      <div>
        <BackLink href="/orders">All orders</BackLink>
        <PageHeader
          title={`Edit ${order.orderNumber}`}
          description="Change the items, delivery or payment of this draft."
        />
        <OrderForm
          key={order.id}
          order={order}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div>
      <BackLink href="/orders">All orders</BackLink>
      <PageHeader
        title={order.orderNumber}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge status={order.paymentStatus} />
            {order.expired ? <ExpiredBadge /> : null}
            <span>
              Created {formatDateTime(order.createdAt)} by{" "}
              {order.source === "ai" ? "an AI agent" : "your team"}
            </span>
          </span>
        }
        actions={canWrite ? <ActionBar order={order} onEdit={() => setEditing(true)} /> : null}
      />

      {order.expired ? (
        <p className="mb-4 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          The hold on this order has run out. It will be cancelled automatically and its stock
          released.
        </p>
      ) : null}
      {order.stockAlert === "commit_failed" ? (
        <p
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Stock could not be taken out for this order. Check the inventory for its items.
        </p>
      ) : null}

      <div className="space-y-4">
        <LinesCard order={order} />
        <div className="grid gap-4 lg:grid-cols-2">
          <CustomerCard order={order} />
          <PaymentCard order={order} />
        </div>
        <OrderTimeline id={order.id} />
      </div>
    </div>
  );
}
