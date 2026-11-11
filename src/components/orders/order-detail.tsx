"use client";

import { useState } from "react";
import Link from "next/link";
import { ShoppingCart, TriangleAlert } from "lucide-react";

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
  const holding =
    order.holdExpiresAt !== null &&
    (order.status === "draft" || order.paymentStatus === "awaiting_payment");
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
        <p className="mt-4 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          Online payment links arrive in a later update.
        </p>
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
