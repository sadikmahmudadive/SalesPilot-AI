import { NextResponse, type NextRequest } from "next/server";

import { decideRedirect } from "@/lib/auth/redirect";

/**
 * Route proxy (Next 16 name for middleware). This is a UX REDIRECT ONLY: it checks that a
 * `__session` cookie is present, not that it is valid. It is not a security boundary.
 * Real verification happens on the server via `requireUser()` / `verifySessionValue()`
 * (session revocation included), and every API route and data access must call those.
 *
 * Decision logic lives in `@/lib/auth/redirect` (pure, unit-tested). `/api/*`, `_next/*`
 * and static files are excluded by the matcher and are never intercepted.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const hasCookie = Boolean(request.cookies.get("__session")?.value);
  const target = decideRedirect(pathname, search, hasCookie);
  if (target) return NextResponse.redirect(new URL(target, request.url));
  return NextResponse.next();
}

// Matcher values must be static constants. Keep in sync with PROTECTED_PREFIXES (guarded by a unit test).
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/inbox/:path*",
    "/agents/:path*",
    "/customers/:path*",
    "/products/:path*",
    "/inventory/:path*",
    "/orders/:path*",
    "/voice/:path*",
    "/automations/:path*",
    "/analytics/:path*",
    "/integrations/:path*",
    "/settings/:path*",
    "/login",
    "/register",
  ],
};
