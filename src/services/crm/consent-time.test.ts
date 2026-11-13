import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";

import { MAX_CONSENT_FUTURE_MS, normalizeConsentAt } from "./consent-time";

const NOW = Date.parse("2026-11-08T12:00:00.000Z");

describe("normalizeConsentAt", () => {
  it("stores a +06:00 offset as the equivalent Z instant", () => {
    expect(normalizeConsentAt("2026-11-08T10:30:00+06:00", NOW)).toBe("2026-11-08T04:30:00.000Z");
  });

  it("handles negative offsets and keeps Z instants unchanged", () => {
    expect(normalizeConsentAt("2026-11-08T01:00:00-05:00", NOW)).toBe("2026-11-08T06:00:00.000Z");
    expect(normalizeConsentAt("2024-01-02T03:04:05.000Z", NOW)).toBe("2024-01-02T03:04:05.000Z");
  });

  it("accepts a time up to 5 minutes ahead (clock skew)", () => {
    const edge = new Date(NOW + MAX_CONSENT_FUTURE_MS).toISOString();
    expect(normalizeConsentAt(edge, NOW)).toBe(edge);
  });

  it("rejects a time more than 5 minutes ahead, with a static message", () => {
    const err = (() => {
      try {
        normalizeConsentAt(new Date(NOW + MAX_CONSENT_FUTURE_MS + 1000).toISOString(), NOW);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details).toEqual([
      { path: "consent.at", message: "Consent date cannot be in the future" },
    ]);
  });

  it("rejects an offset time that is in the future once converted to UTC", () => {
    expect(() => normalizeConsentAt("2026-11-08T05:00:00-08:00", NOW)).toThrow(ValidationError);
  });
});
