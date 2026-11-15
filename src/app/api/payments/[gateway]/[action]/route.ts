import type { NextRequest } from "next/server";

import { clientIp } from "@/lib/api/client-ip";
import { newRequestId, toErrorResponse } from "@/lib/api/respond";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { recordWebhookEvent } from "@/repositories/payments";
import { GATEWAY_PROVIDERS, type GatewayProvider } from "@/schemas/integration";
import { confirmPaymentAttempt } from "@/services/payments/callbacks";
import { getPaymentGateway } from "@/services/payments/gateways/registry";

export const dynamic = "force-dynamic";

const RATE_LIMIT = { limit: 60, windowSec: 60 } as const;

async function handleCallback(
  req: NextRequest,
  segment: { params: Promise<{ gateway: string; action: string }> },
): Promise<Response> {
  const requestId = newRequestId();
  try {
    const ip = clientIp(req);
    await assertRateLimit(`pay.callback:${ip}`, RATE_LIMIT);

    const { gateway, action } = await segment.params;
    if (!GATEWAY_PROVIDERS.includes(gateway as GatewayProvider)) {
      return Response.json({ error: "Invalid payment gateway" }, { status: 400 });
    }

    const gw = getPaymentGateway(gateway as GatewayProvider);

    // Extract query parameters
    const query: Record<string, string | undefined> = {};
    req.nextUrl.searchParams.forEach((val, key) => {
      query[key] = val;
    });

    // Extract body (form urlencoded or json)
    let body: Record<string, unknown> = {};
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      params.forEach((val, key) => {
        body[key] = val;
      });
    } else if (contentType.includes("application/json")) {
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        // Ignored, body stays empty
      }
    }

    const { tranId, gatewayRef } = gw.parseCallback({ query, body });
    const token = query.token;

    if (tranId) {
      // Deduplicate callback event
      const eventKey = `${action}_${tranId}_${gatewayRef ?? "none"}`;
      await recordWebhookEvent(gateway, eventKey);

      // Confirm attempt
      await confirmPaymentAttempt(tranId, gatewayRef);
    }

    if (action === "ipn") {
      return Response.json({ status: "ok" }, { status: 200 });
    }

    // Redirect to status page
    const origin = req.nextUrl.origin;
    const redirectPath = token
      ? `/pay/${token}/status?tranId=${encodeURIComponent(tranId ?? "")}&status=${action}`
      : `/pay/status?tranId=${encodeURIComponent(tranId ?? "")}&status=${action}`;

    return Response.redirect(new URL(redirectPath, origin), 303);
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}

export async function GET(
  req: NextRequest,
  segment: { params: Promise<{ gateway: string; action: string }> },
): Promise<Response> {
  return handleCallback(req, segment);
}

export async function POST(
  req: NextRequest,
  segment: { params: Promise<{ gateway: string; action: string }> },
): Promise<Response> {
  return handleCallback(req, segment);
}
