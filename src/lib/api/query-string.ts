/** Helpers shared by the list hooks' query builders. Pure. */

/** The trimmed string, or "" for anything that is not a string (so blank and absent look the same). */
export const clean = (v: string | undefined): string => (typeof v === "string" ? v.trim() : "");

/** Adds `limit` (when positive) and `cursor` (when not blank) to `out`. */
export function setPaging(out: URLSearchParams, params: { limit?: number; cursor?: string }): void {
  if (typeof params.limit === "number" && params.limit > 0) out.set("limit", String(params.limit));
  const cursor = clean(params.cursor);
  if (cursor) out.set("cursor", cursor);
}
