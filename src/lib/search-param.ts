/** A text value from a page's `searchParams` (first value, trimmed, at most `max` characters). Pure. */
export function textParam(value: string | string[] | undefined, max = 100): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
}
