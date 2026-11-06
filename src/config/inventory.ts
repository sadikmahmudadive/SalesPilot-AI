/**
 * Inventory constants shared by services, API routes and (later) the UI. Pure: no imports.
 */

/** A stock unit is "low" when `available <= LOW_STOCK_THRESHOLD` (so 5 is low, 6 is not). */
export const LOW_STOCK_THRESHOLD = 5;

/** Largest single manual adjustment (absolute value). */
export const MAX_ADJUST_DELTA = 1_000_000;

/** Largest `onHand` an adjustment may produce. */
export const MAX_ON_HAND = 1_000_000_000;

export const MIN_REASON_LENGTH = 3;
export const MAX_REASON_LENGTH = 200;
