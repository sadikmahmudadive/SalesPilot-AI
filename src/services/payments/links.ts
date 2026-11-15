import { createHash, randomBytes } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { listGatewayAccounts } from "@/repositories/integrations";
import { orderRepo } from "@/repositories/orders";
import { createPaymentLink as saveLink, getPaymentLink as readLink } from "@/repositories/payments";
import type { OrderLine } from "@/schemas/order";
import type { PublicPaymentView } from "@/schemas/payment";
import { getOrderSettings } from "@/services/orders/settings";

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

export interface PaymentLinkResult {
  token: string;
  url: string;
  expiresAt: Date;
}

/**
 * Creates a public payment link for a confirmed online order.
 */
export async function createPaymentLink(
  organizationId: string,
  orderId: string,
  appUrl: string,
): Promise<PaymentLinkResult> {
  const order = await orderRepo.get(organizationId, orderId);
  if (!order) throw new NotFoundError("Order not found");

  if (order.status !== "confirmed") {
    throw new ValidationError(
      undefined,
      `Payment links can only be generated for confirmed orders (current status: ${order.status})`,
    );
  }

  if (order.paymentMethod === "cod") {
    throw new ValidationError(undefined, "Cash on delivery orders do not require a payment link");
  }

  if (order.paymentStatus === "paid" || order.paymentStatus === "cod_collected") {
    throw new ValidationError(undefined, "This order is already paid");
  }

  let expiresAtDate: Date;
  if (order.holdExpiresAt) {
    expiresAtDate = toDate(order.holdExpiresAt);
  } else {
    const settings = await getOrderSettings(organizationId);
    expiresAtDate = new Date(Date.now() + settings.paymentHoldHours * 60 * 60 * 1000);
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);

  await saveLink({
    tokenHash,
    organizationId,
    orderId,
    expiresAt: Timestamp.fromDate(expiresAtDate),
    createdAt: Timestamp.now(),
  });

  const baseUrl = appUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/pay/${token}`;

  return {
    token,
    url,
    expiresAt: expiresAtDate,
  };
}

/**
 * Resolves a token into a public payment checkout view (scrubbed of private customer address/phone).
 */
export async function resolvePaymentLink(token: string): Promise<PublicPaymentView> {
  const tokenHash = hashToken(token);
  const link = await readLink(tokenHash);
  if (!link || link.revokedAt) {
    throw new NotFoundError("Payment link is invalid or has expired");
  }

  const expiresAtDate = toDate(link.expiresAt);
  const isExpired = expiresAtDate.getTime() <= Date.now();

  const order = await orderRepo.get(link.organizationId, link.orderId);
  if (!order) throw new NotFoundError("Order associated with payment link was not found");

  // Load org name
  const orgSnap = await adminDb().collection("organizations").doc(link.organizationId).get();
  const orgName = (orgSnap.data()?.name as string | undefined) ?? "Merchant";

  // Load enabled gateway accounts
  const accounts = await listGatewayAccounts(link.organizationId);
  const availableGateways = accounts
    .filter((a) => a.enabled)
    .map((a) => ({
      id: a.id,
      provider: a.provider,
      label: a.label,
      isDefault: a.isDefault,
    }));

  let status: PublicPaymentView["status"] = "awaiting_payment";
  if (order.paymentStatus === "paid" || order.paymentStatus === "cod_collected") {
    status = "paid";
  } else if (order.status === "cancelled") {
    status = "cancelled";
  } else if (isExpired) {
    status = "expired";
  }

  return {
    orderNumber: order.orderNumber,
    organizationName: orgName,
    lines: order.lines.map((l: OrderLine) => ({
      name: l.productName,
      variantName: l.variantLabel ?? undefined,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      totalMinor: l.lineTotalMinor,
    })),
    deliveryChargeMinor: order.deliveryChargeMinor,
    discountMinor: order.discountMinor,
    totalMinor: order.totalMinor,
    currency: "BDT",
    status,
    availableGateways,
    expiresAt: expiresAtDate.toISOString(),
  };
}
