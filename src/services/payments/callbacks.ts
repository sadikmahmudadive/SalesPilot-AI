import { Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { getGatewayAccount } from "@/repositories/integrations";
import { orderRepo } from "@/repositories/orders";
import { getPaymentAttempt } from "@/repositories/payments";
import type { Order } from "@/schemas/order";
import type { PaymentAttempt } from "@/schemas/payment";

import { getPaymentGateway } from "./gateways/registry";

export interface ConfirmAttemptResult {
  outcome: "paid" | "failed" | "pending";
  attempt: PaymentAttempt;
  order?: Order;
}

/**
 * Server-to-server verification and transactional status update for a payment attempt.
 * This is the ONLY code path in the system that marks an order paid via an online gateway.
 */
export async function confirmPaymentAttempt(
  tranId: string,
  gatewayRef?: string,
): Promise<ConfirmAttemptResult> {
  const attempt = await getPaymentAttempt(tranId);
  if (!attempt) {
    logger.warn("Payment verification attempted for unknown tranId", {
      tranId,
      gatewayRef,
    });
    return {
      outcome: "failed",
      attempt: {
        tranId,
        organizationId: "",
        orderId: "",
        gatewayAccountId: "",
        gateway: "mock",
        expectedAmountMinor: 0,
        currency: "BDT",
        state: "failed",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      },
    };
  }

  // If already terminal (paid or failed), return current state
  if (attempt.state === "paid" || attempt.state === "failed") {
    const existingOrder = await orderRepo.get(attempt.organizationId, attempt.orderId);
    return {
      outcome: attempt.state,
      attempt,
      order: existingOrder ?? undefined,
    };
  }

  const account = await getGatewayAccount(attempt.organizationId, attempt.gatewayAccountId);
  if (!account) {
    throw new Error(`Gateway account ${attempt.gatewayAccountId} not found for attempt ${tranId}`);
  }

  const gateway = getPaymentGateway(account.provider);
  const verifyResult = await gateway.verify(account, {
    tranId,
    gatewayRef: gatewayRef ?? attempt.gatewayRef,
  });

  const db = adminDb();
  const now = Timestamp.now();
  const nowIso = new Date().toISOString();

  let finalOutcome: "paid" | "failed" | "pending" = "pending";
  let finalOrder: Order | undefined;

  await db.runTransaction(async (tx) => {
    // 1. Re-read attempt in transaction
    const attemptSnap = await tx.get(db.collection("paymentAttempts").doc(tranId));
    if (!attemptSnap.exists) return;
    const currentAttempt = attemptSnap.data() as PaymentAttempt;

    if (currentAttempt.state === "paid") {
      finalOutcome = "paid";
      return;
    }

    // 2. Re-read order in transaction
    const orderDocRef = db.collection("orders").doc(attempt.orderId);
    const orderSnap = await tx.get(orderDocRef);
    if (!orderSnap.exists) {
      tx.update(attemptSnap.ref, {
        state: "failed",
        failureReason: "order_not_found",
        updatedAt: now,
      });
      finalOutcome = "failed";
      return;
    }
    const order = orderSnap.data() as Order;

    if (verifyResult.outcome === "paid") {
      // Validate amount and currency
      const amountMatches =
        verifyResult.amountMinor !== undefined &&
        verifyResult.amountMinor === attempt.expectedAmountMinor;
      const currencyMatches = verifyResult.currency === "BDT";

      if (!amountMatches || !currencyMatches) {
        logger.error("Payment amount/currency mismatch", {
          tranId,
          expectedMinor: attempt.expectedAmountMinor,
          receivedMinor: verifyResult.amountMinor,
          currency: verifyResult.currency,
        });

        tx.update(attemptSnap.ref, {
          state: "failed",
          failureReason: "amount_mismatch",
          raw: verifyResult.raw,
          updatedAt: now,
        });

        // Add security audit event to order
        const eventRef = db.collection("orderEvents").doc();
        tx.set(eventRef, {
          id: eventRef.id,
          organizationId: order.organizationId,
          orderId: order.id,
          type: "note",
          from: null,
          to: null,
          actor: { kind: "system", id: "payments" },
          detail: `Payment verification failed: amount mismatch (expected ৳${(
            attempt.expectedAmountMinor / 100
          ).toFixed(2)}, got ৳${((verifyResult.amountMinor ?? 0) / 100).toFixed(2)})`,
          createdAt: nowIso,
        });

        finalOutcome = "failed";
        return;
      }

      // Valid payment!
      tx.update(attemptSnap.ref, {
        state: "paid",
        gatewayRef: gatewayRef ?? attempt.gatewayRef,
        verifiedAt: now,
        riskFlag: verifyResult.riskFlag ?? false,
        raw: verifyResult.raw,
        updatedAt: now,
      });

      // Update order
      const isCancelled = order.status === "cancelled";
      const orderPatch: Partial<Order> = {
        paymentStatus: "paid",
        holdExpiresAt: null,
        updatedAt: nowIso,
      };

      if (isCancelled) {
        // Paid after cancellation (hold expired while customer was checking out)
        logger.warn("Order was paid after cancellation", {
          orderId: order.id,
          tranId,
        });
      }

      tx.update(orderDocRef, orderPatch);

      // Add order event
      const eventRef = db.collection("orderEvents").doc();
      tx.set(eventRef, {
        id: eventRef.id,
        organizationId: order.organizationId,
        orderId: order.id,
        type: "status_changed",
        from: order.paymentStatus,
        to: "paid",
        actor: { kind: "system", id: `gateway:${account.provider}` },
        detail: isCancelled
          ? `Paid after cancellation via ${account.label} (Txn: ${verifyResult.gatewayTxnId ?? tranId}). Stock not re-reserved.`
          : `Payment verified via ${account.label} (Txn: ${verifyResult.gatewayTxnId ?? tranId})${
              verifyResult.riskFlag ? " [Risk Warning: Flagged by Gateway]" : ""
            }`,
        createdAt: nowIso,
      });

      finalOutcome = "paid";
      finalOrder = { ...order, ...orderPatch };
    } else if (verifyResult.outcome === "failed") {
      tx.update(attemptSnap.ref, {
        state: "failed",
        failureReason: "gateway_reported_failure",
        raw: verifyResult.raw,
        updatedAt: now,
      });

      if (order.paymentStatus === "awaiting_payment") {
        tx.update(orderDocRef, {
          paymentStatus: "failed",
          updatedAt: nowIso,
        });
      }

      finalOutcome = "failed";
    } else {
      // Pending
      finalOutcome = "pending";
    }
  });

  const updatedAttempt = (await getPaymentAttempt(tranId)) ?? attempt;
  return {
    outcome: finalOutcome,
    attempt: updatedAttempt,
    order: finalOrder,
  };
}
