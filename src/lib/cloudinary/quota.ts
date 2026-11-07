/**
 * Hourly quotas for `confirmUpload`. Server-only.
 *
 * Each confirm costs one Cloudinary Admin API call, and Cloudinary rate-limits the Admin API per
 * ACCOUNT (an hourly allowance shared by every tenant). Without these quotas one member could burn
 * the allowance and make confirm fail for every organization. They sit on top of the route's
 * per-minute limit and are checked BEFORE any SDK call.
 *
 * Keys: `uploads.confirm.user:{uid}:h` and `uploads.confirm.org:{orgId}:h` (the rate limiter hashes
 * them). `CONFIRM_QUOTA` is exported mutable only as a test seam, so tests can lower the limits
 * without waiting an hour.
 */
import "server-only";

import { assertRateLimit } from "@/lib/security/rate-limit";

export const CONFIRM_QUOTA = {
  userPerHour: 120,
  orgPerHour: 300,
  windowSec: 3600,
};

export async function assertConfirmQuota(
  uid: string,
  orgId: string,
  now: number = Date.now(),
): Promise<void> {
  const { userPerHour, orgPerHour, windowSec } = CONFIRM_QUOTA;
  await assertRateLimit(`uploads.confirm.user:${uid}:h`, { limit: userPerHour, windowSec }, now);
  await assertRateLimit(`uploads.confirm.org:${orgId}:h`, { limit: orgPerHour, windowSec }, now);
}
