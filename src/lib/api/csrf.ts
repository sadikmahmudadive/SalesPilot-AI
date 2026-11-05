/**
 * CSRF / login-CSRF guard for mutating API routes. Pure (no env, no I/O): takes a `Request`,
 * throws a typed `AppError` (map it with `toErrorResponse`).
 *
 * Stable API (Task 8's `withApi` calls it for every mutating route):
 *
 *   assertJsonSameOrigin(req, { requireJson?: boolean })   // requireJson defaults to true
 *
 * Checks, in this order, for non-safe methods only (anything but GET / HEAD / OPTIONS):
 *  1. `Sec-Fetch-Site`, if present, must be `same-origin` or `none`            -> ForbiddenError (403)
 *  2. `Origin`, if present, must equal this request's own origin               -> ForbiddenError (403)
 *     Own origin = `new URL(req.url).origin`, or the public origin described by
 *     `x-forwarded-proto` + `x-forwarded-host` (first entry of each) when running behind a proxy
 *     such as Vercel. The raw `Host` header is deliberately NOT trusted on its own: a request
 *     that sends `Origin: https://evil.com` together with `Host: evil.com` still fails.
 *  3. If `requireJson` and the request carries a body, `Content-Type` must be `application/json`
 *     (case-insensitive, optional parameters such as `; charset=utf-8`)   -> UnsupportedMediaTypeError (415)
 *
 * A missing `Origin` / `Sec-Fetch-Site` is allowed (non-browser clients such as curl or server-to-server
 * callers). Browsers always send them on cross-site requests, and a cross-site HTML form can only send
 * text/plain, urlencoded or multipart bodies, which the content-type rule rejects.
 *
 * Why this exists: `SameSite=Lax` cookies ARE attached to cross-site top-level form POSTs, so without
 * these checks an attacker page could log a victim into the attacker's account (login CSRF).
 */
import { ForbiddenError, UnsupportedMediaTypeError } from "@/lib/errors";

export interface CsrfOptions {
  /** Require `Content-Type: application/json` on requests that carry a body. Default true. */
  requireJson?: boolean;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function firstValue(header: string | null): string | undefined {
  const v = header?.split(",")[0]?.trim();
  return v ? v : undefined;
}

function allowedOrigins(req: Request): Set<string> {
  const allowed = new Set<string>();
  allowed.add(new URL(req.url).origin);
  const host = firstValue(req.headers.get("x-forwarded-host"));
  if (host) {
    const proto = firstValue(req.headers.get("x-forwarded-proto"))?.toLowerCase() ?? new URL(req.url).protocol.slice(0, -1);
    try {
      allowed.add(new URL(`${proto}://${host}`).origin);
    } catch {
      // Malformed forwarded headers simply do not widen the allow-list.
    }
  }
  return allowed;
}

function carriesBody(req: Request): boolean {
  if (req.body !== null) return true;
  const length = Number(req.headers.get("content-length"));
  return Number.isFinite(length) && length > 0;
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const mediaType = value.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

export function assertJsonSameOrigin(req: Request, opts: CsrfOptions = {}): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return;
  const requireJson = opts.requireJson ?? true;

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite !== null) {
    const site = fetchSite.trim().toLowerCase();
    if (site !== "same-origin" && site !== "none") throw new ForbiddenError("Cross-site request blocked");
  }

  const origin = req.headers.get("origin");
  if (origin !== null) {
    let normalized: string | undefined;
    try {
      // "null" and garbage fail to parse (or parse to the opaque origin "null") and are rejected below.
      normalized = new URL(origin).origin;
    } catch {
      normalized = undefined;
    }
    if (normalized === undefined || !allowedOrigins(req).has(normalized)) {
      throw new ForbiddenError("Cross-origin request blocked");
    }
  }

  if (requireJson && carriesBody(req) && !isJsonContentType(req.headers.get("content-type"))) {
    throw new UnsupportedMediaTypeError();
  }
}
