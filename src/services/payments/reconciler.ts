import { Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { updatePaymentAttempt } from "@/repositories/payments";
import type { PaymentAttempt } from "@/schemas/payment";

import { confirmPaymentAttempt } from "./callbacks";

export interface ReconcileResult {
  checked: number;
  reconciled: number;
  expired: number;
  errors: number;
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 50;

function toDate(val: unknown): Date {
  if (val instanceof Date) return val;
  if (
    typeof val === "object" &&
    val !== null &&
    "toDate" in val &&
    typeof (val as { toDate: () => Date }).toDate === "function"
  ) {
    return (val as { toDate: () => Date }).toDate();
  }
  if (typeof val === "string") return new Date(val);
  return new Date();
}

/**
 * Sweeps unverified or hanging payment attempts (created | redirected).
 * - Attempts 15m..48h old: calls gateway verification (reconciles lost callbacks).
 * - Attempts >48h old: marks expired.
 */
export async function reconcilePaymentAttempts(
  limit = DEFAULT_LIMIT,
  maxDurationMs = 15_000,
): Promise<ReconcileResult> {
  const deadline = Date.now() + maxDurationMs;
  const now = Date.now();
  const minAgeTime = new Date(now - FIFTEEN_MINUTES_MS);
  const maxAgeTime = new Date(now - FORTY_EIGHT_HOURS_MS);

  const db = adminDb();
  const result: ReconcileResult = {
    checked: 0,
    reconciled: 0,
    expired: 0,
    errors: 0,
  };

  try {
    const snap = await db
      .collection("paymentAttempts")
      .where("state", "in", ["created", "redirected"])
      .where("createdAt", "<=", Timestamp.fromDate(minAgeTime))
      .limit(limit)
      .get();

    for (const doc of snap.docs) {
      if (Date.now() > deadline) break;
      result.checked++;

      const attempt = doc.data() as PaymentAttempt;
      const createdDate = toDate(attempt.createdAt);

      try {
        if (createdDate.getTime() < maxAgeTime.getTime()) {
          // Older than 48 hours -> expire
          await updatePaymentAttempt(attempt.tranId, {
            state: "expired",
            failureReason: "attempt_timed_out_48h",
          });
          result.expired++;
        } else {
          // Re-verify against gateway
          const confirmRes = await confirmPaymentAttempt(attempt.tranId, attempt.gatewayRef);
          if (confirmRes.outcome !== "pending") {
            result.reconciled++;
          }
        }
      } catch (err) {
        result.errors++;
        logger.error("Error reconciling payment attempt", {
          tranId: attempt.tranId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logger.error("Failed to query payment attempts for reconciliation", {
      error: err instanceof Error ? err.message : String(err),
    });
    result.errors++;
  }

  return result;
}
