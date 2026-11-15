/**
 * Client IP for per-IP rate limiting of routes without a session.
 *
 * The first x-forwarded-for entry is client-controlled in general; it is trusted here ONLY
 * because the deployment platform (Vercel) overwrites x-forwarded-for with the real client
 * address. Do not deploy behind a proxy that appends to it.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
