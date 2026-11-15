import type { NextRequest } from "next/server";
import { z } from "zod";

import { clientIp } from "@/lib/api/client-ip";
import { newRequestId, toErrorResponse } from "@/lib/api/respond";
import { ValidationError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { createPaymentSession } from "@/services/payments/attempts";

export const dynamic = "force-dynamic";

const RATE_LIMIT = { limit: 15, windowSec: 60 } as const;

const bodySchema = z.object({
  gatewayAccountId: z.string().trim().min(1, "Gateway account is required"),
});

export async function POST(
  req: NextRequest,
  segment: { params: Promise<{ token: string }> },
): Promise<Response> {
  const requestId = newRequestId();
  try {
    const ip = clientIp(req);
    await assertRateLimit(`pay.session:${ip}`, RATE_LIMIT);

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      throw new ValidationError(undefined, "Request body must be valid JSON");
    }

    const { gatewayAccountId } = bodySchema.parse(rawBody);
    const { token } = await segment.params;
    const origin = req.nextUrl.origin;

    const data = await createPaymentSession(token, gatewayAccountId, origin);

    const res = Response.json({ data }, { status: 200 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
