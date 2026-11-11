/**
 * GET /api/cron/orders/expire -> runs the order hold-expiry sweep (src/services/orders/sweep.ts).
 *
 * Called by Vercel Cron (vercel.json), which sends `Authorization: Bearer ${CRON_SECRET}`; an
 * external scheduler can call it the same way. No session, so not `withApi`:
 *   1. per-IP rate limit (30 per 60 s, before anything else, so the endpoint can't be hammered);
 *   2. `CRON_SECRET` unset -> 503 NOT_CONFIGURED;
 *   3. the header must equal `Bearer ${CRON_SECRET}` (constant-time compare of SHA-256 digests,
 *      so neither the content nor the length of the secret leaks) -> else 401;
 *   4. 200 with the `SweepResult` counts.
 * Every response is `Cache-Control: no-store`. The header and secret are never logged.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { getServerEnv } from "@/config/env";
import { clientIp } from "@/lib/api/client-ip";
import { newRequestId, toErrorResponse } from "@/lib/api/respond";
import { UnauthenticatedError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { sweepOrders } from "@/services/orders/sweep";

export const dynamic = "force-dynamic";
/** Above the sweep's 45 s budget, so a run always returns its counts. */
export const maxDuration = 60;

const RATE_LIMIT = { limit: 30, windowSec: 60 } as const;

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** Equal-length buffers (two digests), compared in constant time. */
function isAuthorized(header: string | null, secret: string): boolean {
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}

function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(req: Request): Promise<Response> {
  const requestId = newRequestId();
  try {
    await assertRateLimit(`cron.orders.expire:${clientIp(req)}`, RATE_LIMIT);

    const secret = getServerEnv().CRON_SECRET;
    if (!secret) {
      return noStore(
        Response.json(
          { error: { code: "NOT_CONFIGURED", message: "Cron is not configured", requestId } },
          { status: 503 },
        ),
      );
    }
    if (!isAuthorized(req.headers.get("authorization"), secret)) {
      throw new UnauthenticatedError("Invalid cron credentials");
    }

    return noStore(Response.json(await sweepOrders()));
  } catch (err) {
    return noStore(toErrorResponse(err, requestId));
  }
}
