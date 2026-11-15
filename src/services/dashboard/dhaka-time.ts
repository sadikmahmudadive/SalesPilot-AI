/**
 * Day and month boundaries in Asia/Dhaka. Pure.
 *
 * Bangladesh is UTC+6 all year (no daylight saving since 2009), so a fixed offset is exact; this
 * avoids a time-zone library for two boundaries. Shift the instant into "Dhaka wall-clock as UTC",
 * floor it there, and shift back.
 */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant of the most recent local midnight in Dhaka (inclusive: `now` on the boundary returns itself). */
export function dhakaDayStart(now: Date): Date {
  const local = now.getTime() + DHAKA_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - DHAKA_OFFSET_MS);
}

/** The instant of local midnight on the first day of the current Dhaka calendar month. */
export function dhakaMonthStart(now: Date): Date {
  const local = new Date(now.getTime() + DHAKA_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - DHAKA_OFFSET_MS);
}
