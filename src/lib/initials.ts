/** Avatar initials: first and last word of the display name, else the email local part, else "?". */
const startsWithLetter = (word: string): boolean => /^\p{L}/u.test(word);
const firstChar = (word: string): string => Array.from(word)[0]!.toLocaleUpperCase();

function fromWords(words: string[]): string | null {
  const usable = words.filter(startsWithLetter);
  if (usable.length === 0) return null;
  const first = usable[0]!;
  const last = usable[usable.length - 1]!;
  return usable.length === 1 ? firstChar(first) : firstChar(first) + firstChar(last);
}

export function initialsFor(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string {
  const fromName = displayName ? fromWords(displayName.trim().split(/\s+/)) : null;
  if (fromName) return fromName;
  const local = email ? (email.split("@")[0] ?? "") : "";
  return fromWords(local.split(/[._\-+\s]+/).filter(Boolean)) ?? "?";
}
