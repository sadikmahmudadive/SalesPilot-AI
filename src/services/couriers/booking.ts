import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { assertEntityId, assertOrgCtx } from "@/lib/org-context";
import { writeAuditInTransaction } from "@/lib/security/audit";
import { getCourierAccount } from "@/repositories/couriers";
import { buildOrderEvent, orderRepo } from "@/repositories/orders";
import {
  bookShipmentInputSchema,
  type BookShipmentInput,
  type OrderShipment,
} from "@/schemas/courier";
import type { Order } from "@/schemas/order";
import { eventActorOf } from "@/services/orders/drafts";
import { markDelivered, markReturned, markShipped } from "@/services/orders/lifecycle";
import type { OrderCtx } from "@/services/orders/settings";

import { getCourierAdapter } from "./registry";
import { toOrderLifecycleEffect } from "./status-map";
import type { CourierStatusEvent, ParcelInput, ParcelResult } from "./types";

const SERVICE = "Couriers";

function isTransientCourierError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  if (/timed?\s*out/i.test(msg)) return true;
  if (/econnreset|etimedout|enotfound|fetch failed|networkerror/i.test(msg)) return true;
  if (/(?:status\s*(?:code)?\s*[:=]?\s*|code\s*[:=]?\s*)(500|502|503|504)\b/i.test(msg)) return true;
  return false;
}

/**
 * Books shipment with the selected courier adapter with concurrency protection and deduplication.
 */
export async function bookShipment(
  ctx: OrderCtx,
  orderId: string,
  input: BookShipmentInput,
): Promise<Order> {
  assertOrgCtx(ctx, SERVICE);
  assertEntityId(orderId);
  const orgId = ctx.organizationId;

  const parsedInput = bookShipmentInputSchema.parse(input);

  const account = await getCourierAccount(orgId, parsedInput.courierAccountId);
  if (!account) {
    throw new NotFoundError("Courier account not found");
  }
  if (!account.enabled) {
    throw new ConflictError("Courier account is disabled");
  }

  const adapter = getCourierAdapter(account.provider);
  if (adapter.requiresLocation) {
    if (account.provider === "pathao" && (!parsedInput.location?.cityId || !parsedInput.location?.zoneId)) {
      throw new ConflictError("Pathao courier requires city and zone");
    }
  }

  const orderRef = orderRepo.docRef(orderId);

  // 1. Transaction T1: Validate eligibility, check concurrency, acquire lock
  const lockResult = await adminDb().runTransaction(async (tx) => {
    const order = orderRepo.fromSnapshot(await tx.get(orderRef), orgId);
    if (!order) throw new NotFoundError("Order not found");

    if (order.status !== "confirmed" && order.status !== "processing") {
      throw new ConflictError("Order cannot be booked for shipping in its current state");
    }
    if (order.status === "confirmed" && order.paymentMethod !== "cod") {
      throw new ConflictError("Online orders must be paid or processing before booking shipment");
    }
    if (
      order.status === "processing" &&
      order.paymentMethod === "online" &&
      order.paymentStatus !== "paid" &&
      !order.allowUnpaidReason
    ) {
      throw new ConflictError("Online orders must be paid before booking courier");
    }

    // Already booked: idempotent return
    if (order.shipment?.bookingState === "booked") {
      return { order, alreadyBooked: true, previousBookingState: "booked", codAmountMinor: 0 };
    }

    // Booking lock check (< 60s)
    if (order.shipment?.bookingState === "booking") {
      if (order.shipment.bookingLockAt) {
        const lockAge = Date.now() - new Date(order.shipment.bookingLockAt).getTime();
        if (lockAge < 60_000) {
          throw new ConflictError("Courier booking is already in progress");
        }
      }
    }

    const codAmountMinor =
      parsedInput.codAmountMinor !== undefined
        ? parsedInput.codAmountMinor
        : order.paymentMethod === "cod"
          ? order.totalMinor
          : 0;

    const previousBookingState = order.shipment?.bookingState ?? null;
    const nowIso = new Date().toISOString();

    const lockingShipment: OrderShipment = {
      ...(order.shipment ?? {}),
      courierAccountId: account.id,
      provider: account.provider,
      bookingState: "booking",
      bookingLockAt: nowIso,
      status: order.shipment?.status ?? "booked",
      codAmountMinor,
      weightKg: parsedInput.weightKg,
      location: parsedInput.location ?? null,
    };

    tx.update(orderRef, {
      shipment: lockingShipment,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      order,
      alreadyBooked: false,
      previousBookingState,
      codAmountMinor,
    };
  });

  if (lockResult.alreadyBooked) {
    return lockResult.order;
  }

  const { order, previousBookingState, codAmountMinor } = lockResult;

  // 2. Outside transaction: Look up invoice (if recovering from booking_unknown) or call createParcel
  const recipientAddress = [
    order.shippingAddress.line1,
    order.shippingAddress.area,
    order.shippingAddress.district,
  ]
    .filter(Boolean)
    .join(", ");

  const parcelInput: ParcelInput = {
    invoice: order.orderNumber,
    recipientName: order.shippingAddress.recipientName,
    recipientPhone: order.shippingAddress.phoneE164,
    recipientAddress,
    deliveryZone: order.shippingAddress.zone,
    cityId: parsedInput.location?.cityId ?? undefined,
    cityName: parsedInput.location?.cityName ?? undefined,
    zoneId: parsedInput.location?.zoneId ?? undefined,
    zoneName: parsedInput.location?.zoneName ?? undefined,
    areaId: parsedInput.location?.areaId ?? undefined,
    areaName: parsedInput.location?.areaName ?? undefined,
    codAmountMinor,
    weightKg: parsedInput.weightKg,
    note: parsedInput.note,
    itemDescription:
      parsedInput.itemDescription ??
      order.lines.map((l) => `${l.productName} x${l.quantity}`).join(", "),
  };

  let parcelResult: ParcelResult | null = null;
  let isAdopted = false;

  if (previousBookingState === "booking_unknown" && adapter.findParcelByInvoice) {
    try {
      const existing = await adapter.findParcelByInvoice(account, order.orderNumber);
      if (existing) {
        parcelResult = {
          consignmentId: existing.consignmentId,
          trackingCode: existing.trackingCode,
          trackingUrl: existing.trackingUrl,
          raw: { adopted: true, ...existing },
        };
        isAdopted = true;
      }
    } catch (err) {
      logger.warn("Courier parcel lookup by invoice failed during unknown state recovery", {
        err,
        orderId,
      });
    }
  }

  if (!parcelResult) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error("Courier API timed out after 15s")), 15_000);
        t.unref?.();
      });
      parcelResult = await Promise.race([
        adapter.createParcel(account, parcelInput),
        timeoutPromise,
      ]);
    } catch (err: unknown) {
      const isTransient = isTransientCourierError(err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      const targetBookingState = isTransient ? "booking_unknown" : "failed";

      await adminDb().runTransaction(async (tx) => {
        const currentOrder = orderRepo.fromSnapshot(await tx.get(orderRef), orgId);
        if (!currentOrder) return;
        const currentShipment: OrderShipment = {
          ...(currentOrder.shipment ?? {}),
          courierAccountId: account.id,
          provider: account.provider,
          bookingState: targetBookingState,
          bookingLockAt: null,
          status: currentOrder.shipment?.status ?? "unknown",
          codAmountMinor,
          weightKg: parsedInput.weightKg,
          location: parsedInput.location ?? null,
          errorMessage: errorMsg,
        };
        tx.update(orderRef, {
          shipment: currentShipment,
          updatedAt: FieldValue.serverTimestamp(),
        });
        const event = buildOrderEvent(orgId, {
          orderId,
          type: "courier_status",
          from: currentOrder.shipment?.status ?? null,
          to: currentShipment.status,
          actor: eventActorOf(ctx),
          detail: `Booking ${targetBookingState}: ${errorMsg}`,
        });
        tx.create(event.ref, event.data);
        writeAuditInTransaction(tx, {
          organizationId: orgId,
          actorUid: ctx.uid,
          action: `order.shipment.${targetBookingState}`,
          resource: "order",
          resourceId: orderId,
          before: { bookingState: "booking" },
          after: { bookingState: targetBookingState, errorMessage: errorMsg },
        });
      });

      if (isTransient) {
        throw new ConflictError(
          `Courier booking could not be verified (timed out or courier server error). Shipment is marked as unknown. Please verify with courier before retrying. (${errorMsg})`,
        );
      } else {
        throw new ConflictError(`Courier rejected booking: ${errorMsg}`);
      }
    }
  }

  // 3. Transaction T2: Record success, write events and audit
  await adminDb().runTransaction(async (tx) => {
    const currentOrder = orderRepo.fromSnapshot(await tx.get(orderRef), orgId);
    if (!currentOrder) throw new NotFoundError("Order not found");

    const nowIso = new Date().toISOString();
    const bookedShipment: OrderShipment = {
      courierAccountId: account.id,
      provider: account.provider,
      bookingState: "booked",
      bookingLockAt: null,
      consignmentId: parcelResult.consignmentId,
      trackingCode: parcelResult.trackingCode ?? null,
      trackingUrl: parcelResult.trackingUrl ?? null,
      chargeMinor: parcelResult.chargeMinor ?? null,
      status: "booked",
      rawStatus: "booked",
      statusAt: nowIso,
      codAmountMinor,
      weightKg: parsedInput.weightKg,
      location: parsedInput.location ?? null,
      bookedAt: nowIso,
      lastSyncedAt: nowIso,
      errorMessage: null,
    };

    tx.update(orderRef, {
      shipment: bookedShipment,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const event = buildOrderEvent(orgId, {
      orderId,
      type: "courier_booked",
      from: null,
      to: "booked",
      actor: eventActorOf(ctx),
      detail: `${isAdopted ? "Adopted parcel" : "Booked parcel"} with ${account.provider.toUpperCase()} (${account.label}). Consignment: ${parcelResult.consignmentId}${parcelResult.trackingCode ? `, Tracking: ${parcelResult.trackingCode}` : ""}`,
    });
    tx.create(event.ref, event.data);

    writeAuditInTransaction(tx, {
      organizationId: orgId,
      actorUid: ctx.uid,
      action: "order.shipment.booked",
      resource: "order",
      resourceId: orderId,
      before: { bookingState: previousBookingState },
      after: {
        bookingState: "booked",
        provider: account.provider,
        consignmentId: parcelResult.consignmentId,
        trackingCode: parcelResult.trackingCode ?? null,
        adopted: isAdopted,
      },
    });
  });

  return (await orderRepo.get(orgId, orderId))!;
}

/**
 * Synchronizes a courier status update with an order, respecting monotonic timestamp ordering
 * and triggering order lifecycle transitions when appropriate.
 */
export async function syncCourierStatus(
  ctx: OrderCtx,
  orderId: string,
  event: CourierStatusEvent,
): Promise<Order> {
  assertOrgCtx(ctx, SERVICE);
  assertEntityId(orderId);
  const orgId = ctx.organizationId;
  const orderRef = orderRepo.docRef(orderId);

  const transitionData = await adminDb().runTransaction(async (tx) => {
    const order = orderRepo.fromSnapshot(await tx.get(orderRef), orgId);
    if (!order) throw new NotFoundError("Order not found");
    if (!order.shipment || order.shipment.bookingState !== "booked") {
      throw new ConflictError("Order does not have a booked shipment");
    }

    const eventAt = event.at ?? new Date();
    // Monotonic check: prevent older status updates from overwriting newer ones
    if (order.shipment.statusAt) {
      const currentAt = new Date(order.shipment.statusAt).getTime();
      if (eventAt.getTime() < currentAt) {
        logger.info("Ignoring out-of-order courier status update", {
          orderId,
          currentAt: order.shipment.statusAt,
          eventAt: eventAt.toISOString(),
        });
        return { order, changed: false, targetStatus: order.shipment.status };
      }
    }

    const nowIso = new Date().toISOString();
    const updatedShipment: OrderShipment = {
      ...order.shipment,
      status: event.status,
      rawStatus: event.rawStatus,
      statusAt: eventAt.toISOString(),
      lastSyncedAt: nowIso,
    };

    tx.update(orderRef, {
      shipment: updatedShipment,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const changed = order.shipment.status !== event.status;
    if (changed) {
      const orderEvt = buildOrderEvent(orgId, {
        orderId,
        type: "courier_status",
        from: order.shipment.status,
        to: event.status,
        actor: eventActorOf(ctx),
        detail: `Status: ${event.rawStatus} (${event.status})`,
      });
      tx.create(orderEvt.ref, orderEvt.data);

      writeAuditInTransaction(tx, {
        organizationId: orgId,
        actorUid: ctx.uid,
        action: "order.shipment.status_changed",
        resource: "order",
        resourceId: orderId,
        before: { status: order.shipment.status },
        after: { status: event.status, rawStatus: event.rawStatus },
      });
    }

    return { order, changed, targetStatus: event.status };
  });

  // Apply lifecycle transitions if courier status changed
  if (transitionData.changed) {
    const effect = toOrderLifecycleEffect(transitionData.targetStatus);
    if (effect) {
      const current = (await orderRepo.get(orgId, orderId))!;
      if (effect.targetOrderStatus === "shipped") {
        if (current.status === "confirmed" || current.status === "processing") {
          await markShipped(ctx, orderId);
        }
      } else if (effect.targetOrderStatus === "delivered") {
        if (current.status === "shipped") {
          await markDelivered(ctx, orderId);
        }
      } else if (effect.targetOrderStatus === "returned") {
        if (current.status === "shipped" || current.status === "delivered") {
          await markReturned(ctx, orderId);
        }
      }
    }
  }

  return (await orderRepo.get(orgId, orderId))!;
}

/**
 * Manually queries the courier adapter for current parcel status and synchronizes the order.
 */
export async function refreshShipmentStatus(ctx: OrderCtx, orderId: string): Promise<Order> {
  assertOrgCtx(ctx, SERVICE);
  assertEntityId(orderId);
  const orgId = ctx.organizationId;

  const order = await orderRepo.get(orgId, orderId);
  if (!order) throw new NotFoundError("Order not found");
  if (!order.shipment || !order.shipment.consignmentId || order.shipment.bookingState !== "booked") {
    throw new ConflictError("Order does not have a booked shipment");
  }

  const account = await getCourierAccount(orgId, order.shipment.courierAccountId);
  if (!account) throw new NotFoundError("Courier account not found");

  const adapter = getCourierAdapter(account.provider);
  const statusRes = await adapter.getStatus(account, order.shipment.consignmentId);

  return syncCourierStatus(ctx, orderId, {
    consignmentId: order.shipment.consignmentId,
    trackingCode: order.shipment.trackingCode ?? undefined,
    status: statusRes.status,
    rawStatus: statusRes.rawStatus,
    at: statusRes.at ?? new Date(),
  });
}
