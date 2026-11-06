/**
 * Tag rules shared by the customer UI and the CRM query layer. Pure: no server or client imports.
 *
 * `tagKey` is the canonical comparison key (NFKC, trimmed, lower-cased); the service stores it in
 * `tagsLower` and the tag filter normalises the same way. `dedupeTags` uses it, so two tags that
 * the service would index identically are never kept as separate chips.
 */

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

export function tagKey(tag: string): string {
  return tag.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

/** Trims each tag and drops blanks and key-duplicates, keeping the first spelling and the order. */
export function dedupeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    const key = tagKey(tag);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}
