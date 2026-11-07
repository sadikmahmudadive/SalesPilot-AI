/**
 * GET /api/auth/expired?next=/some/path
 *
 * Landing point for the dashboard layout when the session cookie is missing, invalid, expired or
 * revoked. A server component cannot delete cookies, and the proxy would bounce /login straight back
 * to /dashboard while a (stale) cookie is present, so this handler clears it and sends the user to
 * the login page with a validated `next`.
 *
 * Why a GET is acceptable: it is idempotent and its only side effect is clearing the CALLER'S OWN
 * session cookie, which an attacker cannot read or abuse (worst case a cross-site link signs the
 * visitor out locally, equivalent to cookie expiry). No auth is required, tokens are NOT revoked
 * (the session is already invalid), and the redirect target is always a relative path:
 * `next` goes through `safeNextPath`; anything unsafe (or the default) is omitted.
 *
 * Plain `Response` (not NextResponse) so it can be called directly in tests.
 */
import { DEFAULT_AFTER_LOGIN, safeNextPath } from "@/lib/auth/redirect";
import { clearSessionCookie } from "@/lib/auth/session";

export function GET(req: Request): Response {
  const raw = new URL(req.url).searchParams.get("next");
  const next = safeNextPath(raw);
  // /dashboard is the post-login default, so omitting it is equivalent (and covers hostile values).
  const location =
    next === DEFAULT_AFTER_LOGIN ? "/login" : `/login?next=${encodeURIComponent(next)}`;
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      "Set-Cookie": clearSessionCookie(),
      "Cache-Control": "no-store",
    },
  });
}
