/**
 * The order state machine. Pure: no Firestore, no server-only. No order status or payment status
 * is ever changed except through `transition`.
 *
 * Transition table (everything else throws `OrderTransitionError`):
 *   confirm  draft                                           -> confirmed
 *   process  confirmed (cod, or paid, or allowUnpaid)        -> processing
 *   ship     confirmed (cod only), processing                -> shipped
 *   deliver  shipped (cod_pending becomes cod_collected)     -> delivered
 *   return   shipped, delivered                              -> returned
 *   cancel   draft, confirmed, processing (not paid)         -> cancelled
 *   expire   draft; confirmed with awaiting_payment/failed   -> cancelled
 *   refund   any status, paymentStatus paid                  -> unchanged status, refunded
 */
import { ConflictError } from "@/lib/errors";
import type { OrderStatus, PaymentMethod, PaymentStatus } from "@/schemas/order";

export type OrderAction =
  | "confirm"
  | "process"
  | "ship"
  | "deliver"
  | "return"
  | "cancel"
  | "expire"
  | "refund";

/** In `OrderAction` union order; `allowedActions` preserves it. */
const ACTIONS: readonly OrderAction[] = [
  "confirm",
  "process",
  "ship",
  "deliver",
  "return",
  "cancel",
  "expire",
  "refund",
];

export interface TransitionInput {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  allowUnpaid?: boolean;
}

export interface TransitionResult {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
}

export class OrderTransitionError extends ConflictError {
  constructor() {
    super("This order can't do that in its current state");
    this.name = "OrderTransitionError";
  }
}

export class OrderExpiredError extends ConflictError {
  constructor() {
    super("The order hold has expired");
    this.name = "OrderExpiredError";
  }
}

export function initialPaymentStatus(method: PaymentMethod): PaymentStatus {
  return method === "cod" ? "cod_pending" : "awaiting_payment";
}

function target(input: TransitionInput, action: OrderAction): TransitionResult | null {
  const { status, paymentStatus, paymentMethod, allowUnpaid } = input;
  const to = (s: OrderStatus, p: PaymentStatus = paymentStatus): TransitionResult => ({
    status: s,
    paymentStatus: p,
  });

  switch (action) {
    case "confirm":
      return status === "draft" ? to("confirmed") : null;
    case "process":
      return status === "confirmed" &&
        (paymentMethod === "cod" || paymentStatus === "paid" || allowUnpaid === true)
        ? to("processing")
        : null;
    case "ship":
      return (status === "confirmed" && paymentMethod === "cod") || status === "processing"
        ? to("shipped")
        : null;
    case "deliver":
      return status === "shipped"
        ? to("delivered", paymentStatus === "cod_pending" ? "cod_collected" : paymentStatus)
        : null;
    case "return":
      return status === "shipped" || status === "delivered" ? to("returned") : null;
    case "cancel":
      return (status === "draft" || status === "confirmed" || status === "processing") &&
        paymentStatus !== "paid"
        ? to("cancelled")
        : null;
    case "expire":
      return status === "draft" ||
        (status === "confirmed" &&
          (paymentStatus === "awaiting_payment" || paymentStatus === "failed"))
        ? to("cancelled")
        : null;
    case "refund":
      return paymentStatus === "paid" ? to(status, "refunded") : null;
    default:
      return null;
  }
}

/** Applies `action`, or throws `OrderTransitionError` when the table does not allow it. */
export function transition(input: TransitionInput, action: OrderAction): TransitionResult {
  const result = target(input, action);
  if (!result) throw new OrderTransitionError();
  return result;
}

export function allowedActions(input: TransitionInput): OrderAction[] {
  return ACTIONS.filter((action) => target(input, action) !== null);
}
