import { createHash, randomBytes } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { getGatewayAccount } from "@/repositories/integrations";
import { orderRepo } from "@/repositories/orders";
import {
  createPaymentAttempt,
  getPaymentLink,
  updatePaymentAttempt,
} from "@/repositories/payments";
import type { PaymentAttempt } from "@/schemas/payment";

import { getPaymentGateway } from "./gateways/registry";

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function toDate(val: unknown): Date {
  if (val instanceof Date) return val;
  if (typeof val === "object" && val !== null && "toDate" in val && typeof (val as { toDate: () => Date }).toDate === "function") {
    return (val as { toDate: () => Date }).toDate();
  }
  if (typeof val === "string") return new Date(val);
  return new Date();
}

export interface CreateSessionResult {
  redirectUrl: string;
  tranId: string;
}

/**
 * Initiates a payment session for a customer on the public pay page.
 */
export async function createPaymentSession(
  token: string,
  gatewayAccountId: string,
  origin: string,
): Promise<CreateSessionResult> {
  const tokenHash = hashToken(token);
  const link = await getPaymentLink(tokenHash);
  if (!link || link.revokedAt) {
    throw new NotFoundError("Payment link is invalid or expired");
  }

  const expiresAtDate = toDate(link.expiresAt);
  if (expiresAtDate.getTime() <= Date.now()) {
    throw new ValidationError(undefined, "This payment link has expired");
  }

  const order = await orderRepo.get(link.organizationId, link.orderId);
  if (!order) throw new NotFoundError("Order not found");

  if (order.status !== "confirmed") {
    throw new ValidationError(
      undefined,
      `Cannot initiate payment for order in ${order.status} status`,
    );
  }

  if (order.paymentStatus === "paid" || order.paymentStatus === "cod_collected") {
    throw new ValidationError(undefined, "This order has already been paid");
  }

  const account = await getGatewayAccount(link.organizationId, gatewayAccountId);
  if (!account || !account.enabled) {
    throw new NotFoundError("Payment gateway account is unavailable");
  }

  const gateway = getPaymentGateway(account.provider);

  // Generate 128-bit random base32 / hex transaction ID
  const tranId = `SPTR_${randomBytes(12).toString("hex").toUpperCase()}`;
  const now = Timestamp.now();

  const baseUrl = origin.replace(/\/+$/, "");
  const urls = {
    success: `${baseUrl}/api/payments/${account.provider}/success?tranId=${tranId}&token=${token}`,
    fail: `${baseUrl}/api/payments/${account.provider}/fail?tranId=${tranId}&token=${token}`,
    cancel: `${baseUrl}/api/payments/${account.provider}/cancel?tranId=${tranId}&token=${token}`,
    ipn: `${baseUrl}/api/payments/${account.provider}/ipn`,
  };

  const initialAttempt: PaymentAttempt = {
    tranId,
    organizationId: link.organizationId,
    orderId: link.orderId,
    gatewayAccountId: account.id,
    gateway: account.provider,
    expectedAmountMinor: order.totalMinor,
    currency: "BDT",
    state: "created",
    createdAt: now,
    updatedAt: now,
  };
  await createPaymentAttempt(initialAttempt);

  try {
    const session = await gateway.createSession(account, {
      tranId,
      amountMinor: order.totalMinor,
      currency: "BDT",
      orderNumber: order.orderNumber,
      customer: {
        name: order.customerSnapshot.name,
        phoneE164: order.customerSnapshot.phoneE164,
      },
      urls,
    });

    await updatePaymentAttempt(tranId, {
      state: "redirected",
      gatewayRef: session.gatewayRef,
    });

    return {
      redirectUrl: session.redirectUrl,
      tranId,
    };
  } catch (err) {
    await updatePaymentAttempt(tranId, {
      state: "failed",
      failureReason: err instanceof Error ? err.message : "Session creation error",
    });
    throw err;
  }
}
