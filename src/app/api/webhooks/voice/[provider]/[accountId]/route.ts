import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/lib/errors";
import { VOICE_PROVIDERS, type VoiceProvider } from "@/schemas/voice";
import { handleVoiceWebhook } from "@/services/voice/webhooks";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ provider: string; accountId: string }>;
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
    const { provider, accountId } = await context.params;
    if (!(VOICE_PROVIDERS as readonly string[]).includes(provider)) {
      return NextResponse.json({ error: "Unsupported voice provider" }, { status: 400 });
    }

    const rawBody = await req.text();
    const contentType = req.headers.get("content-type") ?? "";
    let body: unknown = {};

    if (contentType.includes("application/x-www-form-urlencoded")) {
      body = Object.fromEntries(new URLSearchParams(rawBody).entries());
    } else if (rawBody.trim().length > 0) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
      }
    }

    const res = await handleVoiceWebhook(provider as VoiceProvider, accountId, {
      method: "POST",
      headers: normalizeHeaders(req.headers),
      url: req.url,
      rawBody,
      body,
    });

    if (res.contentType === "text/xml") {
      return new NextResponse(String(res.body), {
        status: res.status,
        headers: { "Content-Type": "text/xml; charset=utf-8" },
      });
    }

    return NextResponse.json(res.body, { status: res.status });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
