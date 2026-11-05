/**
 * Pure redirect decisions for the route proxy (src/proxy.ts). No imports, no env access,
 * so it is safe for any runtime and trivially unit-testable.
 *
 * These are UX redirects only: they look at cookie PRESENCE, not validity. Real
 * verification happens on the server via `requireUser()` / `verifySessionValue()`.
 */

export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/inbox",
  "/agents",
  "/customers",
  "/products",
  "/inventory",
  "/orders",
  "/voice",
  "/automations",
  "/analytics",
  "/integrations",
  "/settings",
] as const;

/** Name of the session cookie. Lives here (pure) so the proxy can share it without importing server-only code. */
export const SESSION_COOKIE_NAME = "__session";

const AUTH_PAGES = ["/login", "/register"] as const;

export const DEFAULT_AFTER_LOGIN = "/dashboard";
const MAX_NEXT_LENGTH = 2048;

/** Exact match or a real sub-path, so `/dashboardfoo` does not count as `/dashboard`. */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Returns the (same-origin, relative) location to redirect to, or null to continue.
 * `search` is the raw query string including the leading `?` (or empty).
 */
export function decideRedirect(pathname: string, search: string, hasCookie: boolean): string | null {
  if (!hasCookie && PROTECTED_PREFIXES.some((p) => matchesPrefix(pathname, p))) {
    return `/login?next=${encodeURIComponent(pathname + search)}`;
  }
  if (hasCookie && AUTH_PAGES.some((p) => matchesPrefix(pathname, p))) {
    return DEFAULT_AFTER_LOGIN;
  }
  return null;
}

/**
 * Validates a `next` value before the login flow navigates to it. Only a same-origin
 * relative path is accepted; anything else (absolute URL, protocol-relative `//host`,
 * `/\host`, backslashes, dot segments, encoded `/` `\` `.` in the path, whitespace/control characters, overlong values) falls back to
 * `/dashboard`. Backslashes are rejected anywhere because browsers treat `\` as `/`.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_NEXT_LENGTH) return DEFAULT_AFTER_LOGIN;
  if (raw[0] !== "/" || raw[1] === "/") return DEFAULT_AFTER_LOGIN;
  // C0 controls (incl. tab/CR/LF), DEL, C1 controls, Unicode line/paragraph separators, backslash.
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029\\]/.test(raw)) return DEFAULT_AFTER_LOGIN;
  // Path part only (the query/fragment may legitimately contain dots or %2F).
  const path = raw.split(/[?#]/, 1)[0]!;
  // Dot segments (`/.//evil.com` normalises to `//evil.com`) and encoded separators/dots are refused.
  if (path.split("/").some((seg) => seg === "." || seg === "..")) return DEFAULT_AFTER_LOGIN;
  if (/%(2e|2f|5c)/i.test(path)) return DEFAULT_AFTER_LOGIN;
  // Belt and braces: after URL resolution it must still be the same origin.
  try {
    if (new URL(raw, "http://sp.invalid").origin !== "http://sp.invalid") return DEFAULT_AFTER_LOGIN;
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
  return raw;
}
