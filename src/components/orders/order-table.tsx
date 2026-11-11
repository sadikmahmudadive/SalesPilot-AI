import Link from "next/link";

import {
  ExpiredBadge,
  OrderStatusBadge,
  PaymentStatusBadge,
} from "@/components/orders/order-badges";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isHoldExpired } from "@/config/order-labels";
import { formatDateTime, formatMoneyMinor } from "@/lib/format";
import type { Order } from "@/schemas/order";

interface OrderTableProps {
  orders: readonly Order[];
  /** Epoch ms used for the Expired badge, so every row agrees. */
  now: number;
  /** Accessible table title, e.g. "Orders, 25 shown". */
  caption: string;
}

function OrderLink({ order }: { order: Order }) {
  return (
    <Link
      href={`/orders/${encodeURIComponent(order.id)}`}
      className="font-medium text-foreground tabular-nums underline-offset-4 hover:underline"
    >
      {order.orderNumber}
    </Link>
  );
}

/** Desktop table (md and up). Mobile uses `OrderCardList`. */
export function OrderTable({ orders, now, caption }: OrderTableProps) {
  return (
    <Card className="hidden gap-0 py-0 md:block">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Order</TableHead>
            <TableHead scope="col">Customer</TableHead>
            <TableHead scope="col" className="text-right">
              Total
            </TableHead>
            <TableHead scope="col">Status</TableHead>
            <TableHead scope="col">Payment</TableHead>
            <TableHead scope="col">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((o) => (
            <TableRow key={o.id}>
              <TableCell>
                <OrderLink order={o} />
              </TableCell>
              <TableCell className="max-w-64 space-y-0.5 whitespace-normal">
                <div className="truncate">{o.customerSnapshot.name}</div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {o.customerSnapshot.phoneE164}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoneyMinor(o.totalMinor)}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5">
                  <OrderStatusBadge status={o.status} />
                  {isHoldExpired(o, now) ? <ExpiredBadge /> : null}
                </div>
              </TableCell>
              <TableCell>
                <PaymentStatusBadge status={o.paymentStatus} />
              </TableCell>
              <TableCell className="text-muted-foreground">{formatDateTime(o.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Mobile card list (below md). */
export function OrderCardList({ orders, now, caption }: OrderTableProps) {
  return (
    <ul className="space-y-3 md:hidden" aria-label={caption}>
      {orders.map((o) => (
        <li key={o.id}>
          <Card size="sm" className="gap-3">
            <div className="space-y-3 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <OrderLink order={o} />
                  <p className="truncate text-sm">{o.customerSnapshot.name}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {o.customerSnapshot.phoneE164}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-medium tabular-nums">
                  {formatMoneyMinor(o.totalMinor)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <OrderStatusBadge status={o.status} />
                {isHoldExpired(o, now) ? <ExpiredBadge /> : null}
                <PaymentStatusBadge status={o.paymentStatus} />
              </div>
              <p className="text-xs text-muted-foreground">{formatDateTime(o.createdAt)}</p>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
