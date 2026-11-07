/**
 * Which customer segments count as an open lead on the overview. Pure (no server-only), so the
 * overview page can list them as text and the query builder can filter on them.
 *
 * Derived from CUSTOMER_SEGMENTS (kept in schema order), so a segment renamed in the schema fails
 * to compile here instead of silently counting nothing.
 */
import { CUSTOMER_SEGMENTS, type CustomerSegment } from "@/schemas/customer";

const LEAD_SET: ReadonlySet<CustomerSegment> = new Set<CustomerSegment>([
  "new_lead",
  "interested",
  "qualified_lead",
  "potential_buyer",
]);

export const LEAD_SEGMENTS: readonly CustomerSegment[] = CUSTOMER_SEGMENTS.filter((s) =>
  LEAD_SET.has(s),
);
