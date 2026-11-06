/**
 * Phone normalization to E.164. Pure and dependency-free; never throws.
 *
 * Scope is deliberately narrow: SalesPilot reaches customers over WhatsApp and voice
 * mobile channels, so only MOBILE numbers are supported. Landlines (e.g. Dhaka `02...`)
 * return null on purpose.
 *
 * - Bangladesh (default country) mobile numbers: `01[3-9]\d{8}` in national form, also
 *   `8801...`, `+8801...` and `008801...`. Other operator prefixes (010, 011, 012) are
 *   not allocated mobile ranges and are rejected.
 * - Other countries: the input must be in international form (`+` or `00` prefix)
 *   followed by 8-15 digits, the first of which is non-zero. These are passed through
 *   as `+digits` without per-country validation.
 * - Input is NFKC-normalized (full-width digits become ASCII), then Bangla (U+09E6-09EF)
 *   and Arabic-Indic (U+0660-0669, U+06F0-06F9) digits are mapped to ASCII. Whitespace,
 *   hyphens, dots, parentheses and invisible format characters (bidi marks, zero-width
 *   characters, BOM) are ignored.
 *
 * Anything else (letters, extensions, several numbers in one string, too short/long)
 * returns null.
 */

// Longest plausible raw input: 15 digits plus generous punctuation. Bounds the work done
// on hostile input.
const MAX_RAW_LENGTH = 64;

const BD_NATIONAL = /^01[3-9]\d{8}$/;
const BD_INTERNATIONAL = /^880(1[3-9]\d{8})$/;
const INTERNATIONAL = /^[1-9]\d{7,14}$/;

const NON_ASCII_DIGITS = /[٠-٩۰-۹০-৯]/g;
// Whitespace, separators, and invisible format characters (\p{Cf}: bidi marks, zero-width
// space/joiner, word joiner, BOM, ...) that commonly ride along with pasted numbers.
const IGNORED = /[\p{Cf}\p{Z}\s\-.()]/gu;

function toAsciiDigit(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code >= 0x09e6) return String(code - 0x09e6); // Bangla
  if (code >= 0x06f0) return String(code - 0x06f0); // Extended Arabic-Indic
  return String(code - 0x0660); // Arabic-Indic
}

/** Returns the E.164 form of a supported mobile number, or null when it cannot be normalized. */
export function normalizePhone(raw: string, defaultCountry = "BD"): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RAW_LENGTH) return null;

  // NFKC folds full-width digits (U+FF10-FF19) and similar compatibility forms to ASCII.
  // The length cap above runs first, so this is bounded work.
  const cleaned = raw.normalize("NFKC").replace(IGNORED, "").replace(NON_ASCII_DIGITS, toAsciiDigit);
  if (cleaned.length === 0) return null;

  // International form: `+digits` or `00digits`.
  let international: string | null = null;
  if (cleaned.startsWith("+")) international = cleaned.slice(1);
  else if (cleaned.startsWith("00")) international = cleaned.slice(2);

  if (international !== null) {
    if (!INTERNATIONAL.test(international)) return null;
    // Bangladesh's country code must be followed by a valid mobile number.
    if (international.startsWith("880") && !BD_INTERNATIONAL.test(international)) return null;
    return `+${international}`;
  }

  // Only Bangladesh national / country-code-without-plus forms are understood.
  if (defaultCountry !== "BD") return null;
  if (BD_NATIONAL.test(cleaned)) return `+880${cleaned.slice(1)}`;
  const bd = BD_INTERNATIONAL.exec(cleaned);
  if (bd) return `+880${bd[1]}`;
  return null;
}
