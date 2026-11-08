/**
 * Session cookie auth. Server-only.
 *
 * The browser signs in with Firebase client auth, then POSTs the short-lived ID token to
 * /api/auth/session, which exchanges it for a long-lived, HttpOnly Firebase session cookie.
 * Everything security-relevant takes plain values so it can be tested without a Next
 * request scope; `getCurrentUser` / `requireUser` are thin wrappers over `next/headers`.
 *
 * Never log tokens or cookie values from this module.
 */
import "server-only";

import { getServerEnv } from "@/config/env";
import { SESSION_COOKIE_NAME } from "@/lib/auth/redirect";
import { UnauthenticatedError } from "@/lib/errors";
import { adminAuth } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";

// Defined in the pure redirect module so the proxy can share it; re-exported for server code.
export { SESSION_COOKIE_NAME };

/** An ID token is only exchanged if the user actually signed in within this window. */
export const MAX_AUTH_AGE_SEC = 5 * 60;
/** Tolerated clock skew when comparing `auth_time` with the server clock. */
const CLOCK_SKEW_SEC = 60;

export interface SessionUser {
  uid: string;
  email: string | null;
}

/**
 * Throws `UnauthenticatedError` unless `authTimeSec` (the ID token's `auth_time`, epoch
 * seconds) is a finite number no older than 5 minutes (and not implausibly in the future).
 */
export function assertRecentAuth(authTimeSec: unknown, nowMs: number = Date.now()): void {
  if (typeof authTimeSec !== "number" || !Number.isFinite(authTimeSec)) {
    throw new UnauthenticatedError("Recent sign-in required");
  }
  const ageSec = nowMs / 1000 - authTimeSec;
  if (ageSec > MAX_AUTH_AGE_SEC || ageSec < -CLOCK_SKEW_SEC) {
    throw new UnauthenticatedError("Recent sign-in required");
  }
}

/**
 * Exchanges a freshly issued Firebase ID token for a session cookie value.
 * Any problem with the token (garbage, expired, revoked, stale sign-in) is an
 * `UnauthenticatedError`; SDK error text is never propagated.
 */
export async function createSessionCookie(
  idToken: string,
): Promise<{ value: string; maxAgeSec: number }> {
  if (typeof idToken !== "string" || idToken.length === 0) {
    throw new UnauthenticatedError("Invalid credentials");
  }
  const auth = adminAuth();

  let authTime: unknown;
  try {
    // checkRevoked = true: a token for a user whose sessions were revoked is refused.
    const decoded = await auth.verifyIdToken(idToken, true);
    authTime = decoded.auth_time;
  } catch {
    throw new UnauthenticatedError("Invalid credentials");
  }
  assertRecentAuth(authTime);

  const days = getServerEnv().SESSION_COOKIE_MAX_DAYS;
  const expiresInMs = days * 24 * 60 * 60 * 1000;
  try {
    const value = await auth.createSessionCookie(idToken, { expiresIn: expiresInMs });
    return { value, maxAgeSec: Math.floor(expiresInMs / 1000) };
  } catch {
    throw new UnauthenticatedError("Invalid credentials");
  }
}

/** Firebase Auth error code of `err` when it has one (e.g. `auth/session-cookie-expired`). */
function errorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * True when `err` means "this cookie / its user is not valid" (so the caller should treat the
 * request as signed out), as opposed to "we could not find out" (network, quota, 5xx, bad server
 * credentials), which must not sign the user out.
 *
 * Token and user problems from firebase-admin carry `auth/...` codes (`auth/session-cookie-expired`,
 * `auth/session-cookie-revoked`, `auth/argument-error`, `auth/invalid-session-cookie-duration`,
 * `auth/user-disabled`, `auth/user-not-found`, ...). Two cases are infrastructure despite the prefix:
 * - `auth/internal-error`: the SDK's code for an unexpected backend or transport response.
 * - `auth/argument-error` that is not about the cookie: when firebase-admin cannot download Google's
 *   public certificates it reports the failure as `auth/argument-error` with the fetch error text.
 *   Genuine cookie problems always name the "Firebase session cookie" in their message.
 */
function isInvalidSessionError(err: unknown): boolean {
  const code = errorCode(err);
  if (code === undefined || !code.startsWith("auth/")) return false;
  if (code === "auth/internal-error") return false;
  if (code === "auth/argument-error") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return /session cookie/i.test(message);
    }
  }
  return true;
}

/**
 * Verifies a session cookie value, including revocation.
 *
 * Returns null when there is no usable session: missing/empty input, or Firebase says the cookie or
 * its user is invalid (malformed, tampered, expired, revoked, user disabled/deleted).
 *
 * Any other failure (network, quota, 5xx, `auth/internal-error`, missing server credentials) means we
 * could not decide, so it is logged (error code only, never the cookie) and RETHROWN: callers answer
 * 500 / render the error boundary and the browser keeps its cookie instead of being signed out by a
 * transient outage.
 */
export async function verifySessionValue(value: string | undefined): Promise<SessionUser | null> {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const decoded = await adminAuth().verifySessionCookie(value, true);
    if (!decoded || typeof decoded.uid !== "string" || decoded.uid.length === 0) return null;
    return { uid: decoded.uid, email: typeof decoded.email === "string" ? decoded.email : null };
  } catch (err) {
    if (isInvalidSessionError(err)) return null;
    logger.warn("session_verify_unavailable", { code: errorCode(err) ?? "unknown" });
    throw err;
  }
}

/** Extracts the session cookie value from a raw `Cookie` request header. */
export function readSessionCookie(cookieHeader: string | null | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE_NAME) continue;
    const value = part.slice(eq + 1).trim();
    if (value.length > 0) return value;
  }
  return undefined;
}

// JWT-shaped values only (base64url, dots, and padding): nothing that could add attributes.
const COOKIE_VALUE = /^[A-Za-z0-9._~+/=-]+$/;

/** `Secure` everywhere except explicit development/test, so an unset NODE_ENV fails safe. */
function isSecureCookie(): boolean {
  const env = getServerEnv().NODE_ENV;
  return env !== "development" && env !== "test";
}

function build(value: string, maxAgeSec: number, extra: string[]): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    "Path=/",
    `Max-Age=${maxAgeSec}`,
    ...extra,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isSecureCookie()) parts.push("Secure");
  return parts.join("; ");
}

/** Builds the `Set-Cookie` header value that stores the session. */
export function serializeSessionCookie(value: string, maxAgeSec: number): string {
  if (typeof value !== "string" || !COOKIE_VALUE.test(value))
    throw new Error("Invalid session cookie value");
  if (!Number.isInteger(maxAgeSec) || maxAgeSec < 0)
    throw new Error("Invalid session cookie max-age");
  return build(value, maxAgeSec, []);
}

/** Builds the `Set-Cookie` header value that expires the session cookie. */
export function clearSessionCookie(): string {
  return build("", 0, ["Expires=Thu, 01 Jan 1970 00:00:00 GMT"]);
}

/**
 * Current user from the request's session cookie, or null. Call within a request scope.
 * Rejects (does not return null) if verification could not be completed; see `verifySessionValue`.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  // Imported lazily so tests importing this module need no Next request scope. Errors from
  // cookies() are deliberately not caught: Next uses them to detect dynamic rendering.
  const { cookies } = await import("next/headers");
  const store = await cookies();
  return verifySessionValue(store.get(SESSION_COOKIE_NAME)?.value);
}

/** Like `getCurrentUser` but throws `UnauthenticatedError` when there is no valid session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}
