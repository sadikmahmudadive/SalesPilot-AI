/**
 * POST   /api/auth/session  { idToken }  -> exchange a fresh Firebase ID token for the HttpOnly session cookie
 * DELETE /api/auth/session               -> clear the cookie and revoke the user's refresh tokens
 *
 * Plain `Response` objects (no NextResponse) so handlers can be called directly in tests.
 * Tokens and cookie values are never logged or echoed.
 */
import { z } from "zod";

import {
  clearSessionCookie,
  createSessionCookie,
  readSessionCookie,
  serializeSessionCookie,
  verifySessionValue,
} from "@/lib/auth/session";
import { newRequestId, toErrorResponse } from "@/lib/api/respond";
import { ValidationError } from "@/lib/errors";
import { adminAuth } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { assertRateLimit } from "@/lib/security/rate-limit";

const RATE_LIMIT = { limit: 10, windowSec: 60 } as const;

// Firebase ID tokens are ~1-2 KB; the cap only bounds abuse.
const bodySchema = z.object({ idToken: z.string().min(1).max(8192) });

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function json(body: unknown, setCookie?: string): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return Response.json(body, { status: 200, headers });
}

export async function POST(req: Request): Promise<Response> {
  const requestId = newRequestId();
  try {
    await assertRateLimit(`session:${clientIp(req)}`, RATE_LIMIT);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new ValidationError([{ path: "body", message: "Expected a JSON body" }]);
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => ({ path: i.path.join(".") || "body", message: i.message })),
      );
    }

    const { value, maxAgeSec } = await createSessionCookie(parsed.data.idToken);
    return json({ ok: true }, serializeSessionCookie(value, maxAgeSec));
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const requestId = newRequestId();
  try {
    const value = readSessionCookie(req.headers.get("cookie"));
    const user = await verifySessionValue(value);
    if (user) {
      try {
        await adminAuth().revokeRefreshTokens(user.uid);
      } catch (err) {
        // The cookie is still cleared below; surface the failure to operators only.
        logger.error("session_revoke_failed", { requestId, uid: user.uid, err });
      }
    }
    return json({ ok: true }, clearSessionCookie());
  } catch (err) {
    return toErrorResponse(err, requestId);
  }
}
