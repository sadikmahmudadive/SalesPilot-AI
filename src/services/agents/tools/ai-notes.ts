/**
 * AI-authored customer notes. Pure helpers.
 *
 * The model cannot see the stored notes, so it must never replace them: an AI note is APPENDED
 * as a dated line `[AI YYYY-MM-DD] <text>` (Asia/Dhaka date). The notes field holds at most
 * NOTES_MAX characters; when the combined text is too long the OLDEST lines are dropped first,
 * never the new entry.
 */

/** Longest `preferences.notes` the customer schema accepts. */
export const NOTES_MAX = 1000;
/** Longest note text the tool accepts, so a dated entry always fits in NOTES_MAX on its own. */
export const AI_NOTE_INPUT_MAX = 900;

const dhakaDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Dhaka",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `YYYY-MM-DD` in Asia/Dhaka. */
export function dhakaDate(now: Date = new Date()): string {
  return dhakaDay.format(now);
}

/** One note line: `[AI date] text`, with the text collapsed onto a single line. */
export function aiNoteEntry(text: string, date: string = dhakaDate()): string {
  return `[AI ${date}] ${text.replace(/\s+/g, " ").trim()}`;
}

/** `existing` plus `entry` on a new line, oldest existing lines dropped to fit NOTES_MAX. */
export function appendAiNote(existing: string | undefined, entry: string): string {
  const lines = (existing ?? "").split("\n").filter((line) => line.trim().length > 0);
  while (lines.length > 0 && [...lines, entry].join("\n").length > NOTES_MAX) lines.shift();
  return [...lines, entry].join("\n");
}
