import { describe, expect, it } from "vitest";

import { ConflictError } from "@/lib/errors";
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@/schemas/order";

import {
  OrderExpiredError,
  OrderTransitionError,
  allowedActions,
  initialPaymentStatus,
  transition,
  type OrderAction,
} from "./state-machine";

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

interface Expected {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
}

/** The transition table from the task brief, written independently of the implementation. */
function expectedFor(
  status: OrderStatus,
  paymentStatus: PaymentStatus,
  method: PaymentMethod,
  action: OrderAction,
  allowUnpaid: boolean,
): Expected | null {
  switch (action) {
    case "confirm":
      return status === "draft" ? { status: "confirmed", paymentStatus } : null;
    case "process":
      return status === "confirmed" && (method === "cod" || paymentStatus === "paid" || allowUnpaid)
        ? { status: "processing", paymentStatus }
        : null;
    case "ship":
      return (status === "confirmed" && method === "cod") || status === "processing"
        ? { status: "shipped", paymentStatus }
        : null;
    case "deliver":
      return status === "shipped"
        ? {
            status: "delivered",
            paymentStatus: paymentStatus === "cod_pending" ? "cod_collected" : paymentStatus,
          }
        : null;
    case "return":
      return status === "shipped" || status === "delivered"
        ? { status: "returned", paymentStatus }
        : null;
    case "cancel":
      return ["draft", "confirmed", "processing"].includes(status) && paymentStatus !== "paid"
        ? { status: "cancelled", paymentStatus }
        : null;
    case "expire":
      return status === "draft" ||
        (status === "confirmed" &&
          (paymentStatus === "awaiting_payment" || paymentStatus === "failed"))
        ? { status: "cancelled", paymentStatus }
        : null;
    case "refund":
      return paymentStatus === "paid" ? { status, paymentStatus: "refunded" } : null;
  }
}

const cases = ORDER_STATUSES.flatMap((status) =>
  PAYMENT_STATUSES.flatMap((paymentStatus) =>
    PAYMENT_METHODS.flatMap((method) =>
      ACTIONS.flatMap((action) =>
        [false, true].map((allowUnpaid) => ({
          status,
          paymentStatus,
          method,
          action,
          allowUnpaid,
        })),
      ),
    ),
  ),
);

describe("transition (exhaustive)", () => {
  it("covers every combination", () => {
    expect(cases).toHaveLength(7 * 6 * 2 * 8 * 2);
  });

  it.each(cases)(
    "$action on $status/$paymentStatus/$method (allowUnpaid=$allowUnpaid)",
    ({ status, paymentStatus, method, action, allowUnpaid }) => {
      const input = { status, paymentStatus, paymentMethod: method, allowUnpaid };
      const expected = expectedFor(status, paymentStatus, method, action, allowUnpaid);
      if (expected === null) {
        expect(() => transition(input, action)).toThrow(OrderTransitionError);
      } else {
        expect(transition(input, action)).toEqual(expected);
      }
    },
  );
});

describe("allowedActions", () => {
  it("lists a confirmed COD order's actions in union order", () => {
    expect(
      allowedActions({ status: "confirmed", paymentStatus: "cod_pending", paymentMethod: "cod" }),
    ).toEqual(["process", "ship", "cancel"]);
  });

  it("agrees with the table for every combination", () => {
    for (const status of ORDER_STATUSES)
      for (const paymentStatus of PAYMENT_STATUSES)
        for (const paymentMethod of PAYMENT_METHODS) {
          const allowed = allowedActions({ status, paymentStatus, paymentMethod });
          const expected = ACTIONS.filter(
            (a) => expectedFor(status, paymentStatus, paymentMethod, a, false) !== null,
          );
          expect(allowed).toEqual(expected);
        }
  });

  it("includes process for an unpaid online order only when allowUnpaid is set", () => {
    const input = {
      status: "confirmed",
      paymentStatus: "awaiting_payment",
      paymentMethod: "online",
    } as const;
    expect(allowedActions(input)).not.toContain("process");
    expect(allowedActions({ ...input, allowUnpaid: true })).toContain("process");
  });
});

describe("scenarios", () => {
  it("cannot cancel a paid processing order", () => {
    expect(() =>
      transition(
        { status: "processing", paymentStatus: "paid", paymentMethod: "online" },
        "cancel",
      ),
    ).toThrow(OrderTransitionError);
  });

  it("can cancel after a refund", () => {
    const refunded = transition(
      { status: "processing", paymentStatus: "paid", paymentMethod: "online" },
      "refund",
    );
    expect(refunded).toEqual({ status: "processing", paymentStatus: "refunded" });
    expect(transition({ ...refunded, paymentMethod: "online" }, "cancel")).toEqual({
      status: "cancelled",
      paymentStatus: "refunded",
    });
  });

  it("collects COD on delivery", () => {
    expect(
      transition(
        { status: "shipped", paymentStatus: "cod_pending", paymentMethod: "cod" },
        "deliver",
      ),
    ).toEqual({ status: "delivered", paymentStatus: "cod_collected" });
  });
});

describe("initialPaymentStatus", () => {
  it("maps the method", () => {
    expect(initialPaymentStatus("cod")).toBe("cod_pending");
    expect(initialPaymentStatus("online")).toBe("awaiting_payment");
  });
});

describe("errors", () => {
  it("have static messages and are conflicts", () => {
    const t = new OrderTransitionError();
    const x = new OrderExpiredError();
    expect(t.message).toBe("This order can't do that in its current state");
    expect(x.message).toBe("The order hold has expired");
    expect(t).toBeInstanceOf(ConflictError);
    expect(x).toBeInstanceOf(ConflictError);
    expect(t.status).toBe(409);
  });
});
