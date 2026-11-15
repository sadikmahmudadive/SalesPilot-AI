import { describe, expect, it } from "vitest";

import { AI_NOTE_INPUT_MAX, NOTES_MAX, aiNoteEntry, appendAiNote, dhakaDate } from "./ai-notes";

describe("dhakaDate", () => {
  it("uses the Asia/Dhaka calendar day (UTC+6)", () => {
    expect(dhakaDate(new Date("2026-11-09T17:59:00Z"))).toBe("2026-11-09");
    expect(dhakaDate(new Date("2026-11-09T18:00:00Z"))).toBe("2026-11-10");
  });
});

describe("aiNoteEntry", () => {
  it("prefixes the date and collapses whitespace to one line", () => {
    expect(aiNoteEntry("  wants\n a   quote ", "2026-11-09")).toBe("[AI 2026-11-09] wants a quote");
  });
});

describe("appendAiNote", () => {
  const entry = "[AI 2026-11-09] new";

  it("returns just the entry when there are no notes", () => {
    expect(appendAiNote(undefined, entry)).toBe(entry);
    expect(appendAiNote("", entry)).toBe(entry);
  });

  it("appends after the existing notes on a new line", () => {
    expect(appendAiNote("human note", entry)).toBe(`human note\n${entry}`);
  });

  it("drops the oldest lines first, never the new entry", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `${i}`.repeat(100));
    const out = appendAiNote(lines.join("\n"), entry);
    expect(out.length).toBeLessThanOrEqual(NOTES_MAX);
    expect(out.endsWith(`\n${entry}`)).toBe(true);
    expect(out).not.toContain(lines[0]!);
    expect(out).toContain(lines[9]!);
  });

  it("keeps the new entry even when the old notes are one huge line", () => {
    expect(appendAiNote("x".repeat(NOTES_MAX), entry)).toBe(entry);
  });

  it("always fits the longest allowed input", () => {
    const e = aiNoteEntry("y".repeat(AI_NOTE_INPUT_MAX), "2026-11-09");
    expect(appendAiNote("x".repeat(NOTES_MAX), e)).toBe(e);
    expect(e.length).toBeLessThanOrEqual(NOTES_MAX);
  });
});
