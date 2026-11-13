import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/lib/errors";
import { handleInboundAutomationWebhook } from "@/services/automations/sweep";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ ruleId: string }>;
}

function normalizeHeaders(headers: Headers): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export async function POST(req: NextRequest, context: RouteParams) {
  try {
    const { ruleId } = await context.params;
    const rawBody = await req.text();
    let body: unknown = {};

    if (rawBody.trim().length > 0) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
      }
    }

    const run = await handleInboundAutomationWebhook(ruleId, {
      headers: normalizeHeaders(req.headers),
      body,
      originUrl: req.nextUrl.origin,
    });

    return NextResponse.json({ ok: true, run });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
