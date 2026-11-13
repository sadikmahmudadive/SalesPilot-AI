import type { NextRequest } from "next/server";

import { clientIp } from "@/lib/api/client-ip";
import { newRequestId, toErrorResponse } from "@/lib/api/respond";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { resolvePaymentLink } from "@/services/payments/links";

export const dynamic = "force-dynamic";

const RATE_LIMIT = { limit: 30, windowSec: 60 } as const;

export async function GET(
  req: NextRequest,
  segment: { params: Promise<{ token: string }> },
): Promise<Response> {
  const requestId = newRequestId();
  try {
    const ip = clientIp(req);
    await assertRateLimit(`pay.view:${ip}`, RATE_LIMIT);

    const { token } = await segment.params;
    const data = await resolvePaymentLink(token);

    const res = Response.json({ data }, { status: 200 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
