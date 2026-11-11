/**
 * POST   /api/auth/session  { idToken }  -> exchange a fresh Firebase ID token for the HttpOnly session cookie
 * DELETE /api/auth/session               -> clear the cookie and revoke the user's refresh tokens
 *
 * Sign-out scope: revoking refresh tokens is per USER, not per device, so signing out here signs the
 * user out on ALL devices (every existing session cookie fails its revocation check). This is
 * deliberate (simple and safe); the user menu says so. Per-device sign-out would mean clearing only
 * the local cookie and skipping the revoke call.
 *
 * Every response (success and error envelopes) carries `Cache-Control: no-store`.
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
import { clientIp } from "@/lib/api/client-ip";
import { assertJsonSameOrigin } from "@/lib/api/csrf";
import { newRequestId, toErrorResponse } from "@/lib/api/respond";
import { ValidationError } from "@/lib/errors";
import { adminAuth } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { assertRateLimit } from "@/lib/security/rate-limit";

const RATE_LIMIT = { limit: 10, windowSec: 60 } as const;

// Firebase ID tokens are ~1-2 KB; the cap only bounds abuse.
const bodySchema = z.object({ idToken: z.string().min(1).max(8192) });

function json(body: unknown, setCookie?: string): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return Response.json(body, { status: 200, headers });
}

/** Error envelope from the shared mapper, marked uncacheable like every other response here. */
function fail(err: unknown, requestId: string): Response {
  const res = toErrorResponse(err, requestId);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function POST(req: Request): Promise<Response> {
  const requestId = newRequestId();
  try {
    // Login-CSRF guard first: cross-site / non-JSON requests never reach the limiter or token checks.
    assertJsonSameOrigin(req);
    // Fails closed: if the limiter itself errors (Firestore outage/contention) this surfaces as a 500
    // rather than letting unlimited token-exchange attempts through.
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
    return fail(err, requestId);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const requestId = newRequestId();
  try {
    // Origin / Sec-Fetch-Site check only; DELETE carries no body.
    assertJsonSameOrigin(req, { requireJson: false });
    const value = readSessionCookie(req.headers.get("cookie"));
    // Sign-out must always clear the cookie: if verification cannot complete (Auth outage) the
    // user simply is not revoked this time; verifySessionValue has already logged the error code.
    let user: Awaited<ReturnType<typeof verifySessionValue>> = null;
    try {
      user = await verifySessionValue(value);
    } catch {
      logger.warn("session_revoke_skipped", { requestId });
    }
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
    return fail(err, requestId);
  }
}
