"use client";

import { useRef, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

import { ReasonDialog } from "@/components/orders/reason-dialog";
import { Button } from "@/components/ui/button";
import { ACTION_LABELS } from "@/config/order-labels";
import { useOrderAction, type OrderDetail, type OrderHttpAction } from "@/hooks/use-orders";
import { ApiError } from "@/lib/api/client";
import { allowedActions } from "@/services/orders/state-machine";

const DONE_MESSAGES: Record<OrderHttpAction, string> = {
  confirm: "Order confirmed",
  process: "Order moved to processing",
  ship: "Order marked as shipped",
  deliver: "Order marked as delivered",
  return: "Order marked as returned",
  cancel: "Order cancelled",
  refund: "Refund recorded",
};

/** Actions that ask for a reason first. `process` only does so for an unpaid online order. */
type DialogAction = "cancel" | "refund" | "process";

const BUTTON_VARIANTS: Record<OrderHttpAction, "default" | "outline" | "destructive"> = {
  confirm: "default",
  process: "default",
  ship: "default",
  deliver: "default",
  return: "outline",
  refund: "outline",
  cancel: "destructive",
};

interface ActionBarProps {
  order: OrderDetail;
  /** Opens the order form in edit mode (drafts whose hold is still running). */
  onEdit: () => void;
}

/**
 * The actions the state machine allows for this order, and nothing else. `expire` is the hold
 * sweep's alone. An expired draft can only be cancelled (confirming or editing it would be
 * refused). Callers show this only to people who can write orders.
 */
export function ActionBar({ order, onEdit }: ActionBarProps) {
  const run = useOrderAction(order.id);
  const lock = useRef(false);
  const [dialog, setDialog] = useState<DialogAction | null>(null);

  // `allowUnpaid` only matters for `process` on an unpaid online order, which is then offered with a reason.
  const needsOverride = order.paymentMethod === "online" && order.paymentStatus !== "paid";
  const actions = allowedActions({
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    allowUnpaid: true,
  }).filter((a): a is OrderHttpAction => a !== "expire" && !(a === "confirm" && order.expired));
  const canEdit = order.status === "draft" && !order.expired;

  async function direct(action: "confirm" | "process" | "ship" | "deliver" | "return") {
    if (lock.current) return;
    lock.current = true;
    try {
      await run.mutateAsync({ action });
      toast.success(DONE_MESSAGES[action]);
    } catch (error) {
      // Conflicts ("This order is still being prepared, try again") are shown as the server words them.
      toast.error(
        error instanceof ApiError ? error.message : "Something went wrong. Please try again.",
      );
    } finally {
      lock.current = false;
    }
  }

  function start(action: OrderHttpAction) {
    if (action === "cancel" || action === "refund") setDialog(action);
    else if (action === "process" && needsOverride) setDialog("process");
    else void direct(action);
  }

  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };

  return (
    <>
      {/* The dialogs stay mounted when the last action disappears (the order refreshed mid-request). */}
      {actions.length > 0 || canEdit ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Order actions">
          {canEdit ? (
            <Button variant="outline" onClick={onEdit} disabled={run.isPending}>
              <Pencil aria-hidden="true" />
              Edit draft
            </Button>
          ) : null}
          {actions.map((action) => (
            <Button
              key={action}
              variant={BUTTON_VARIANTS[action]}
              disabled={run.isPending}
              onClick={() => start(action)}
            >
              {run.isPending && run.variables?.action === action ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : null}
              {ACTION_LABELS[action]}
            </Button>
          ))}
        </div>
      ) : null}

      <ReasonDialog
        open={dialog === "cancel"}
        onOpenChange={close}
        title={`Cancel order ${order.orderNumber}?`}
        description="The items are released back to stock. This can't be undone."
        label="Reason for cancelling"
        placeholder="e.g. Customer changed their mind"
        confirmLabel="Cancel order"
        destructive
        onSubmit={async (reason) => {
          await run.mutateAsync({ action: "cancel", body: { reason } });
          toast.success(DONE_MESSAGES.cancel);
        }}
      />
      <ReasonDialog
        open={dialog === "refund"}
        onOpenChange={close}
        title="Record a refund"
        description={`Record why the payment for ${order.orderNumber} is being refunded.`}
        label="Reason for the refund"
        placeholder="e.g. Item returned damaged"
        confirmLabel="Record refund"
        onSubmit={async (reason) => {
          await run.mutateAsync({ action: "refund", body: { reason } });
          toast.success(DONE_MESSAGES.refund);
        }}
      />
      <ReasonDialog
        open={dialog === "process"}
        onOpenChange={close}
        title="Start processing without payment?"
        description="This online order has not been paid. Say why it can go ahead anyway. A payment hold that has already expired can't be overridden."
        label="Reason for proceeding unpaid"
        placeholder="e.g. Customer paid by bank transfer"
        confirmLabel="Start processing"
        onSubmit={async (reason) => {
          await run.mutateAsync({ action: "process", body: { allowUnpaidReason: reason } });
          toast.success(DONE_MESSAGES.process);
        }}
      />
    </>
  );
}
