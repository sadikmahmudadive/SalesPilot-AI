/**
 * Pure logic behind stock adjustments and the low-stock badge. No React, so it is unit tested
 * directly. The server enforces the same rules; this is the immediate, friendly version.
 */
import { LOW_STOCK_THRESHOLD, MAX_ADJUST_DELTA, MAX_ON_HAND } from "@/config/inventory";
import { toAsciiDigits } from "@/lib/digits";

/**
 * Reads the `lowStock` search param of the inventory page. Only the exact single value "true"
 * turns the filter on; anything else (absent, "false", repeated, other text) leaves it off.
 */
export function isLowStockParam(value: string | string[] | undefined): boolean {
  return value === "true";
}

export type AdjustMode = "add" | "remove";

export type StockStatus = "out" | "low" | "ok";

/** Out of stock at 0 (or below), low at <= LOW_STOCK_THRESHOLD, otherwise fine. */
export function stockStatus(available: number): StockStatus {
  if (available <= 0) return "out";
  return available <= LOW_STOCK_THRESHOLD ? "low" : "ok";
}

export type QuantityResult = { ok: true; value: number } | { ok: false; message: string };

const tooLarge = () =>
  `You can adjust by at most ${MAX_ADJUST_DELTA.toLocaleString("en-GB")} at a time`;

const QUANTITY_MESSAGE = "Enter a whole number of 1 or more";

/** Parses the amount typed in the adjust dialog: a positive whole number (the mode supplies the sign). */
export function parseQuantity(input: string): QuantityResult {
  const text = toAsciiDigits(input.normalize("NFKC").trim());
  if (text.length === 0) return { ok: false, message: "Enter a quantity" };
  if (!/^\d+$/.test(text)) return { ok: false, message: QUANTITY_MESSAGE };
  if (text.length > 9) return { ok: false, message: tooLarge() };
  const value = Number(text);
  if (value < 1) return { ok: false, message: QUANTITY_MESSAGE };
  if (value > MAX_ADJUST_DELTA) return { ok: false, message: tooLarge() };
  return { ok: true, value };
}

/** The signed delta for a quantity in the given mode. */
export const toDelta = (quantity: number, mode: AdjustMode): number =>
  mode === "remove" ? -quantity : quantity;

export interface StockCounts {
  onHand: number;
  reserved: number;
}

export type AdjustmentPreview =
  | {
      ok: true;
      onHand: { from: number; to: number };
      available: { from: number; to: number };
      /** e.g. "On hand 12 -> 15, Available 10 -> 13" */
      summary: string;
    }
  | { ok: false; problem: "no-change" | "below-reserved" | "too-many"; message: string };

/**
 * What an adjustment would do. `ok: false` means the change must not be submitted: it is zero,
 * would leave `onHand` below the reserved quantity (the server answers 409), or would exceed
 * the on-hand limit.
 */
export function previewAdjustment(record: StockCounts, delta: number): AdjustmentPreview {
  if (!Number.isInteger(delta) || delta === 0) {
    return { ok: false, problem: "no-change", message: "Enter a quantity to see the result" };
  }
  const nextOnHand = record.onHand + delta;
  if (nextOnHand < record.reserved) {
    return {
      ok: false,
      problem: "below-reserved",
      message:
        record.reserved > 0
          ? `Stock cannot go below the ${record.reserved} reserved for open orders. You can remove at most ${Math.max(0, record.onHand - record.reserved)}.`
          : `Stock cannot go below 0. You can remove at most ${Math.max(0, record.onHand)}.`,
    };
  }
  if (nextOnHand > MAX_ON_HAND) {
    return {
      ok: false,
      problem: "too-many",
      message: `On hand cannot be more than ${MAX_ON_HAND.toLocaleString("en-GB")}`,
    };
  }
  const available = { from: record.onHand - record.reserved, to: nextOnHand - record.reserved };
  const onHand = { from: record.onHand, to: nextOnHand };
  return {
    ok: true,
    onHand,
    available,
    summary: `On hand ${onHand.from} -> ${onHand.to}, Available ${available.from} -> ${available.to}`,
  };
}
