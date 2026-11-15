import { Badge } from "@/components/ui/badge";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_VARIANTS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_VARIANTS,
} from "@/config/order-labels";
import type { OrderStatus, PaymentStatus } from "@/schemas/order";

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={ORDER_STATUS_VARIANTS[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge variant={PAYMENT_STATUS_VARIANTS[status]}>{PAYMENT_STATUS_LABELS[status]}</Badge>;
}

/** Shown when a hold ran out and the sweep has not cancelled the order yet. */
export function ExpiredBadge() {
  return <Badge variant="destructive">Expired</Badge>;
}
