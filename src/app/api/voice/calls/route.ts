import { withApi } from "@/lib/api/handler";
import { listVoiceCalls } from "@/repositories/voice";
import {
  CALL_DIRECTIONS,
  CALL_STATUSES,
  initiateCallInputSchema,
  type CallDirection,
  type CallStatus,
} from "@/schemas/voice";
import { initiateOutboundCall } from "@/services/voice/calls";

export const dynamic = "force-dynamic";

export const GET = withApi(
  { permission: "voice:read" },
  async ({ req, organizationId }) => {
    const sp = new URL(req.url).searchParams;
    const rawDir = sp.get("direction");
    const rawStatus = sp.get("status");
    const customerId = sp.get("customerId") ?? undefined;
    const orderId = sp.get("orderId") ?? undefined;
    const limitParam = Number(sp.get("limit") ?? "50");

    const direction =
      rawDir && (CALL_DIRECTIONS as readonly string[]).includes(rawDir)
        ? (rawDir as CallDirection)
        : undefined;
    const status =
      rawStatus && (CALL_STATUSES as readonly string[]).includes(rawStatus)
        ? (rawStatus as CallStatus)
        : undefined;

    const items = await listVoiceCalls(organizationId, {
      direction,
      status,
      customerId,
      orderId,
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50,
    });

    return { items };
  },
);

export const POST = withApi(
  {
    permission: "voice:write",
    schema: initiateCallInputSchema,
    rateLimit: { name: "voice.calls.create", limit: 30, windowSec: 60 },
  },
  async ({ req, body, organizationId, uid }) => {
    const origin = new URL(req.url).origin;
    const call = await initiateOutboundCall({ organizationId, uid }, body, origin);
    return Response.json({ data: call }, { status: 201 });
  },
);
