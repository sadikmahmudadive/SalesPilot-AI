/**
 * Display formatting for money, counts and dates. Locale and time zone are fixed (en-GB, Asia/Dhaka) so the
 * server and every browser render the same text, whatever their own settings are.
 */

const TIME_ZONE = "Asia/Dhaka";
const FALLBACK = "-";

const moneyFormat = new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT" });
const countFormat = new Intl.NumberFormat("en-GB");
const dateFormat = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, dateStyle: "medium" });
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  dateStyle: "medium",
  timeStyle: "short",
  hourCycle: "h23",
});

/** Formats an amount held in minor units (poisha; 100 = 1 taka) as BDT. */
export function formatMoneyMinor(minor: number | null | undefined): string {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return FALLBACK;
  return moneyFormat.format(minor / 100);
}

/** A whole-number count with en-GB grouping (1,234). */
export function formatCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return FALLBACK;
  return countFormat.format(value);
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string | null | undefined): string {
  const date = toDate(value);
  return date ? dateFormat.format(date) : FALLBACK;
}

export function formatDateTime(value: string | null | undefined): string {
  const date = toDate(value);
  return date ? dateTimeFormat.format(date) : FALLBACK;
}

/** The date when `value` is valid, otherwise `fallback` (e.g. "No activity yet"). */
export function formatDateOr(value: string | null | undefined, fallback: string): string {
  const date = toDate(value);
  return date ? dateFormat.format(date) : fallback;
}
