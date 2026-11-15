import type { NextRequest } from "next/server";
import { z } from "zod";

import { newRequestId, toErrorResponse } from "@/lib/api/respond";
import { setMockOutcome } from "@/services/payments/gateways/mock";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  tranId: z.string().min(1),
  outcome: z.enum(["paid", "failed"]),
});

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = newRequestId();
  try {
    const raw = await req.json();
    const { tranId, outcome } = bodySchema.parse(raw);
    setMockOutcome(tranId, outcome);
    return Response.json({ ok: true, tranId, outcome }, { status: 200 });
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
