import { Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import type { PaymentAttempt, PaymentLink, WebhookEvent } from "@/schemas/payment";

export function paymentAttemptsRef() {
  return adminDb().collection("paymentAttempts");
}

export function paymentLinksRef() {
  return adminDb().collection("paymentLinks");
}

export function webhookEventsRef() {
  return adminDb().collection("webhookEvents");
}

export async function getPaymentAttempt(tranId: string): Promise<PaymentAttempt | null> {
  const snap = await paymentAttemptsRef().doc(tranId).get();
  if (!snap.exists) return null;
  return snap.data() as PaymentAttempt;
}

export async function createPaymentAttempt(attempt: PaymentAttempt): Promise<void> {
  await paymentAttemptsRef().doc(attempt.tranId).create(attempt);
}

export async function updatePaymentAttempt(
  tranId: string,
  patch: Partial<Omit<PaymentAttempt, "tranId" | "organizationId" | "orderId" | "createdAt">>,
): Promise<void> {
  const now = Timestamp.now();
  await paymentAttemptsRef()
    .doc(tranId)
    .update({
      ...patch,
      updatedAt: now,
    });
}

export async function getPaymentLink(tokenHash: string): Promise<PaymentLink | null> {
  const snap = await paymentLinksRef().doc(tokenHash).get();
  if (!snap.exists) return null;
  return snap.data() as PaymentLink;
}

export async function createPaymentLink(link: PaymentLink): Promise<void> {
  await paymentLinksRef().doc(link.tokenHash).set(link);
}

/**
 * Idempotently records a webhook event. Returns true if this is the first time the event
 * was received, or false if it is a duplicate event (ALREADY_EXISTS).
 */
export async function recordWebhookEvent(provider: string, eventKey: string): Promise<boolean> {
  const docId = `${provider}_${eventKey}`;
  const docRef = webhookEventsRef().doc(docId);
  const now = Timestamp.now();

  try {
    await docRef.create({
      id: docId,
      provider,
      eventKey,
      receivedAt: now,
    } satisfies WebhookEvent);
    return true;
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: number }).code === 6) {
      return false; // ALREADY_EXISTS
    }
    throw err;
  }
}
