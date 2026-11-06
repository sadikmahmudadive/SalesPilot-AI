/**
 * Taka text <-> integer minor units (poisha; 100 = 1 taka) for price inputs. Pure.
 *
 * Parsing NEVER multiplies a float: the whole and fraction digits are handled as strings, so
 * "19.99" is exactly 1999 (19.99 * 100 is 1998.9999999999998 in floating point).
 */
import { toAsciiDigits } from "@/lib/digits";
import { MAX_PRICE_MINOR } from "@/schemas/product";

export type MoneyParseResult = { ok: true; minor: number } | { ok: false; message: string };

const INVALID = "Enter an amount like 1200 or 1,200.50";
const TOO_LARGE = "That amount is too large";
const MAX_INPUT_LENGTH = 40;

// Whole part: plain digits, Western grouping (1,234,567) or South Asian grouping (12,34,567).
const AMOUNT = /^(\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.(\d+))?$/;

const fail = (message: string): MoneyParseResult => ({ ok: false, message });

/**
 * Parses a price typed in taka: `1200`, `1200.5`, `1,200.50`, Bangla digits. Rejects negatives,
 * more than two decimals, anything that is not a plain amount, and values above the price
 * limit. An empty string is an error here: optional fields should check for blank first.
 */
export function parseTakaToMinor(input: string): MoneyParseResult {
  if (typeof input !== "string") return fail(INVALID);
  const text = toAsciiDigits(input.normalize("NFKC").trim());
  if (text.length === 0) return fail("Enter an amount");
  if (text.length > MAX_INPUT_LENGTH) return fail(TOO_LARGE);
  if (text.startsWith("-")) return fail("The amount cannot be negative");

  const match = AMOUNT.exec(text);
  if (!match) return fail(INVALID);
  const fraction = match[2] ?? "";
  if (fraction.length > 2) return fail("Use at most 2 decimal places");

  const whole = match[1]!.replaceAll(",", "").replace(/^0+(?=\d)/, "");
  if (whole.length > 10) return fail(TOO_LARGE); // keeps the number below 2^53 before the range check
  const minor = Number(whole + fraction.padEnd(2, "0"));
  return minor > MAX_PRICE_MINOR ? fail(TOO_LARGE) : { ok: true, minor };
}

/** The editable taka text for a stored amount, always with two decimals; "" if it is not a whole non-negative number. */
export function formatMinorToTakaInput(minor: number): string {
  if (typeof minor !== "number" || !Number.isSafeInteger(minor) || minor < 0) return "";
  const whole = Math.floor(minor / 100);
  const cents = String(minor % 100).padStart(2, "0");
  return `${whole}.${cents}`;
}
