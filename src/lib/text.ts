/**
 * Text helpers shared by the customer and product modules. Pure: no server or client imports.
 *
 * Source hygiene: keep this file free of literal invisible/non-ASCII characters and of
 * `\uXXXX` escapes (the editing tools decode escapes into raw characters), so special code
 * points are built with String.fromCharCode / fromCodePoint.
 */

/** True for strings that are empty or hold only whitespace / control / invisible format characters. */
export const isBlank = (v: string): boolean => /^[\s\p{Cc}\p{Cf}]*$/u.test(v);

const ZWNJ = String.fromCharCode(0x200c);
const ZWJ = String.fromCharCode(0x200d);

/**
 * Invisible format characters (\p{Cf}) are stripped from names EXCEPT ZWNJ (U+200C) and ZWJ
 * (U+200D): they control conjunct and letter shaping in Bangla/Persian, so removing them would
 * corrupt real names.
 */
export const STRIPPED_FROM_NAMES = new RegExp(String.raw`(?![${ZWNJ}${ZWJ}])\p{Cf}`, "gu");

/** NFC, invisible format characters removed (except ZWNJ/ZWJ), trimmed. */
export function cleanName(v: string): string {
  return v.normalize("NFC").replace(STRIPPED_FROM_NAMES, "").trim();
}

/**
 * Exclusive upper bound suffix for a prefix range. Firestore compares strings by UTF-8 bytes
 * (= code point order), and U+10FFFF is the largest code point, so `prefix + PREFIX_END` is
 * above every string that starts with `prefix`. (The common U+F8FF suffix would miss values
 * whose next character is above U+F8FF, e.g. emoji.)
 */
export const PREFIX_END = String.fromCodePoint(0x10ffff);

/** Longest stored sort/search key (the repository cursor policy allows strings up to 256). */
export const MAX_SORT_KEY_LENGTH = 256;

/** Whether `s` contains an unpaired surrogate (round-tripping through UTF-8 replaces it). */
export function hasLoneSurrogate(s: string): boolean {
  return /\p{Cs}/u.test(s); // in unicode mode only an UNPAIRED surrogate matches \p{Cs}
}

export function truncateUnits(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  const last = s.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // do not split a surrogate pair
  return s.slice(0, end);
}

/**
 * The stored sort/search key for a name: NFKC, lower-cased (locale-independent), whitespace
 * runs collapsed to one space, trimmed, at most 256 UTF-16 units. A search query goes through
 * the same function so both sides always agree.
 */
export function sortKey(text: string): string {
  return truncateUnits(
    text.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim(),
    MAX_SORT_KEY_LENGTH,
  );
}
