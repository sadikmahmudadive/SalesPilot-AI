"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Truck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRefreshShipment, type OrderDetail } from "@/hooks/use-orders";
import { formatDateTime, formatMoneyMinor } from "@/lib/format";
import type { CourierStatus } from "@/schemas/courier";
import type { Order } from "@/schemas/order";

import { BookCourierDialog } from "./book-courier-dialog";

const STATUS_VARIANTS: Record<
  CourierStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  booked: { label: "Booked", variant: "secondary" },
  pending_pickup: { label: "Pending Pickup", variant: "secondary" },
  picked_up: { label: "Picked Up", variant: "default" },
  in_transit: { label: "In Transit", variant: "default" },
  out_for_delivery: { label: "Out for Delivery", variant: "default" },
  delivered: { label: "Delivered", variant: "default" },
  partial_delivered: { label: "Partial Delivery", variant: "secondary" },
  returned: { label: "Returned", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
  on_hold: { label: "On Hold", variant: "outline" },
  unknown: { label: "Unknown", variant: "outline" },
};

function StatusBadge({ status }: { status: CourierStatus }) {
  const cfg = STATUS_VARIANTS[status] ?? { label: status, variant: "outline" };
  return (
    <Badge variant={cfg.variant} className="capitalize">
      {cfg.label}
    </Badge>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-words font-medium">{children}</dd>
    </div>
  );
}

interface ShipmentCardProps {
  order: OrderDetail;
  canWrite: boolean;
  onOrderUpdated?: (order?: Order) => void;
}

export function ShipmentCard({ order, canWrite, onOrderUpdated }: ShipmentCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const refreshMutation = useRefreshShipment(order.id);
  const shipment = order.shipment;

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const handleRefresh = async () => {
    try {
      const updated = await refreshMutation.mutateAsync();
      toast.success("Shipment status refreshed");
      onOrderUpdated?.(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to refresh status");
    }
  };

  const canBook =
    canWrite &&
    (!shipment ||
      shipment.bookingState === "failed" ||
      shipment.bookingState === "booking_unknown") &&
    ((order.status === "confirmed" && order.paymentMethod === "cod") ||
      order.status === "processing");

  return (
    <>
      <SectionCard title="Shipment & Logistics">
        {!shipment ? (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              No courier shipment has been booked for this order yet.
            </p>
            {canBook ? (
              <Button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="gap-2"
                size="sm"
              >
                <Truck className="size-4" />
                Book Courier
              </Button>
            ) : order.paymentMethod === "online" && order.paymentStatus !== "paid" ? (
              <p className="text-xs text-muted-foreground italic">
                Online orders must be paid or approved before booking courier.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-border/40">
              <span className="text-xs text-muted-foreground">Logistics Dispatch</span>
              {shipment.bookingState === "booked" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={refreshMutation.isPending}
                  className="gap-1.5 text-xs h-7 cursor-pointer"
                >
                  {refreshMutation.isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3" />
                  )}
                  Refresh Status
                </Button>
              ) : null}
            </div>
            {/* Warning / Error banners for unconfirmed states */}
            {shipment.bookingState === "booking_unknown" ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">Booking Status Unconfirmed</p>
                  <p className="text-muted-foreground">
                    The previous booking attempt timed out or failed. Please check with your courier
                    portal before retrying to prevent duplicate parcels.
                  </p>
                  {canBook ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDialogOpen(true)}
                      className="mt-1 h-7 text-xs border-amber-500/30 hover:bg-amber-500/10"
                    >
                      Retry Booking / Lookup
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {shipment.bookingState === "failed" ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                <XCircle className="size-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">Booking Failed</p>
                  <p className="text-muted-foreground">
                    {shipment.errorMessage || "The courier rejected the booking request."}
                  </p>
                  {canBook ? (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => setDialogOpen(true)}
                      className="mt-1 h-7 text-xs"
                    >
                      Retry Booking
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Shipment details */}
            <dl className="space-y-2">
              <Row label="Courier Provider">
                <span className="uppercase tracking-wider">{shipment.provider}</span>
              </Row>
              <Row label="Courier Status">
                <StatusBadge status={shipment.status} />
              </Row>
              {shipment.consignmentId ? (
                <Row label="Consignment ID">
                  <span className="inline-flex items-center gap-1 font-mono text-xs">
                    {shipment.consignmentId}
                    <button
                      type="button"
                      onClick={() => handleCopy(shipment.consignmentId!, "Consignment ID")}
                      className="text-muted-foreground hover:text-foreground cursor-pointer"
                      title="Copy Consignment ID"
                    >
                      <Copy className="size-3" />
                    </button>
                  </span>
                </Row>
              ) : null}
              {shipment.trackingCode ? (
                <Row label="Tracking Code">
                  <span className="inline-flex items-center gap-1 font-mono text-xs text-primary">
                    {shipment.trackingCode}
                    <button
                      type="button"
                      onClick={() => handleCopy(shipment.trackingCode!, "Tracking Code")}
                      className="text-muted-foreground hover:text-foreground cursor-pointer"
                      title="Copy Tracking Code"
                    >
                      <Copy className="size-3" />
                    </button>
                    {shipment.trackingUrl ? (
                      <a
                        href={shipment.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground ml-1"
                        title="Open Tracking Page"
                      >
                        <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                  </span>
                </Row>
              ) : null}
              <Row label="Weight">{shipment.weightKg} kg</Row>
              <Row label="COD Amount">{formatMoneyMinor(shipment.codAmountMinor)}</Row>
              {shipment.bookedAt ? (
                <Row label="Booked At">{formatDateTime(shipment.bookedAt)}</Row>
              ) : null}
              {shipment.lastSyncedAt ? (
                <Row label="Last Synced">{formatDateTime(shipment.lastSyncedAt)}</Row>
              ) : null}
            </dl>
          </div>
        )}
      </SectionCard>

      <BookCourierDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        order={order}
        onBooked={(updated) => onOrderUpdated?.(updated)}
      />
    </>
  );
}
