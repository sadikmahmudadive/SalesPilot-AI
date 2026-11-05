/**
 * Fixed-window rate limiter backed by Firestore. Server-only.
 *
 * One counter doc per (key, window): `rateLimits/{sha256(key)[0..32]}_{windowStart}`.
 * The raw key (IP, email, ...) is never stored: not as the doc id and not as a field.
 * The counter is a read-modify-write inside a transaction, so it is exact under
 * concurrency. `expiresAt` lets a Firestore TTL policy garbage-collect old windows.
 *
 * Operational caveats:
 * - Firestore sustains roughly 1 write per second on a single document, so one hot key
 *   is a contention point. Under heavy load on one key the transaction can fail with
 *   ABORTED / contention errors even after the SDK's retries; the caller then sees a
 *   thrown error (typically a 500), not a `{ allowed: false }` result.
 * - Callers MUST use per-client keys scoped to a route (for example `login:${ip}`),
 *   never one global single-doc key shared by every request.
 * - Whether to fail open or fail closed when the limiter itself errors (infrastructure
 *   failure, contention) is the caller's decision; this module does not swallow errors.
 */
import "server-only";
import { createHash } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";

import { RateLimitedError, ValidationError, type ValidationDetail } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";

export interface RateLimitOptions {
  limit: number;
  windowSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Calls left in the current window; never negative. */
  remaining: number;
  /** Epoch milliseconds at which the current window ends. */
  resetAt: number;
}

const COLLECTION = "rateLimits";

function docId(key: string, windowStart: number): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return `${hash}_${windowStart}`;
}

export async function checkRateLimit(
  key: string,
  opts: RateLimitOptions,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const { limit, windowSec } = opts;
  // Details carry field paths and rules only, never the offending values (keys can be PII).
  const problems: ValidationDetail[] = [];
  if (typeof key !== "string" || key.length === 0) {
    problems.push({ path: "key", message: "Must be a non-empty string" });
  }
  if (!Number.isInteger(limit) || limit < 1) {
    problems.push({ path: "opts.limit", message: "Must be a positive integer" });
  }
  if (!Number.isFinite(windowSec) || Math.floor(windowSec * 1000) < 1) {
    problems.push({ path: "opts.windowSec", message: "Must be finite and at least 1 millisecond" });
  }
  if (!Number.isFinite(now)) {
    problems.push({ path: "now", message: "Must be a finite number" });
  }
  if (problems.length > 0) throw new ValidationError(problems, "Invalid rate limit arguments");

  const windowMs = Math.floor(windowSec * 1000);
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;
  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(docId(key, windowStart));

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? Number(snap.get("count") ?? 0) : 0;

    if (count >= limit) return { allowed: false, remaining: 0, resetAt };

    tx.set(ref, {
      count: count + 1,
      windowStart,
      expiresAt: Timestamp.fromMillis(windowStart + 2 * windowMs),
    });
    return { allowed: true, remaining: Math.max(0, limit - count - 1), resetAt };
  });
}

/** Like `checkRateLimit` but throws `RateLimitedError` when the limit is exceeded. */
export async function assertRateLimit(
  key: string,
  opts: RateLimitOptions,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const result = await checkRateLimit(key, opts, now);
  if (!result.allowed) throw new RateLimitedError(Math.max(1, Math.ceil((result.resetAt - now) / 1000)));
  return result;
}
