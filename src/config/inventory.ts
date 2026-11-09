/**
 * Inventory constants shared by services, API routes and (later) the UI. Pure: no imports.
 */

/** A stock unit is "low" when `available <= LOW_STOCK_THRESHOLD` (so 5 is low, 6 is not). */
export const LOW_STOCK_THRESHOLD = 5;

export type StockLevel = "out" | "low" | "ok";

/** The one stock rule: out at 0 (or below), low at <= LOW_STOCK_THRESHOLD, otherwise ok. */
export function stockLevelOf(available: number): StockLevel {
  if (available <= 0) return "out";
  return available <= LOW_STOCK_THRESHOLD ? "low" : "ok";
}

/** Largest single manual adjustment (absolute value). */
export const MAX_ADJUST_DELTA = 1_000_000;

/** Largest `onHand` an adjustment may produce. */
export const MAX_ON_HAND = 1_000_000_000;

export const MIN_REASON_LENGTH = 3;
export const MAX_REASON_LENGTH = 200;
