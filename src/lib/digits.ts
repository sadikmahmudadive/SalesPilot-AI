/**
 * Maps Bangla (U+09E6-09EF), Extended Arabic-Indic (U+06F0-06F9) and Arabic-Indic (U+0660-0669)
 * digits to ASCII digits. Pure. Shared by phone and money parsing.
 *
 * Source hygiene: the ranges are built with String.fromCharCode, so this file holds no literal
 * non-ASCII characters or `\uXXXX` escapes (the editing tools decode escapes).
 */

const BANGLA_ZERO = 0x09e6;
const EXTENDED_ARABIC_ZERO = 0x06f0;
const ARABIC_ZERO = 0x0660;

const range = (zero: number) => `${String.fromCharCode(zero)}-${String.fromCharCode(zero + 9)}`;

const NON_ASCII_DIGITS = new RegExp(
  `[${range(ARABIC_ZERO)}${range(EXTENDED_ARABIC_ZERO)}${range(BANGLA_ZERO)}]`,
  "g",
);

function toAsciiDigit(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code >= BANGLA_ZERO) return String(code - BANGLA_ZERO);
  if (code >= EXTENDED_ARABIC_ZERO) return String(code - EXTENDED_ARABIC_ZERO);
  return String(code - ARABIC_ZERO);
}

/** Replaces every Bangla / Arabic-Indic digit with its ASCII counterpart; other text is untouched. */
export function toAsciiDigits(text: string): string {
  return text.replace(NON_ASCII_DIGITS, toAsciiDigit);
}
