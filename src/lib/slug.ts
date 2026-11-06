/**
 * URL slugs derived from display names. Pure.
 *
 * Rules: NFKC, lower-cased, whitespace to "-", only Unicode letters, combining marks, digits and
 * "-" are kept (marks are essential: Bangla vowel signs are combining marks, so dropping them
 * would corrupt the word), repeated "-" collapsed, "-" trimmed from both ends, at most 80
 * characters. The result contains no "/" and no ".", so it is safe inside a Firestore document id.
 *
 * Source hygiene: no literal non-ASCII characters in this file.
 */

export const MAX_SLUG_LENGTH = 80;
/** Collision suffixes tried per slug: "slug", "slug-2", ... "slug-20". */
export const MAX_SLUG_ATTEMPTS = 20;

/** Slugs are cut by code point (never in the middle of a surrogate pair), then re-trimmed. */
function clip(slug: string, max: number): string {
  return Array.from(slug).slice(0, max).join("").replace(/-+$/u, "");
}

/** Slug of `text`; empty string when nothing slug-worthy remains. */
export function slugify(text: string, max: number = MAX_SLUG_LENGTH): string {
  const slug = text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, "-")
    .replace(/[^\p{L}\p{M}\p{N}-]+/gu, "")
    .replace(/-{2,}/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return clip(slug, max);
}

/** First choice for a name, falling back to the SKU and finally a fixed word. */
export function baseSlug(name: string, sku: string): string {
  return slugify(name) || slugify(sku) || "product";
}

/**
 * Candidate slugs in probe order: `base`, `base-2`, ... `base-20`. The base is shortened so
 * that every candidate (suffix included) stays within 80 characters.
 */
export function slugCandidates(base: string): string[] {
  const out = [base];
  for (let n = 2; n <= MAX_SLUG_ATTEMPTS; n++) {
    const suffix = `-${n}`;
    out.push(`${clip(base, MAX_SLUG_LENGTH - suffix.length)}${suffix}`);
  }
  return out;
}
