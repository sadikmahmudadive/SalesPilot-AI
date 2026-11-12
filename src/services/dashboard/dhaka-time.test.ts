import { describe, expect, it } from "vitest";

import { dhakaDayStart, dhakaMonthStart } from "./dhaka-time";

const at = (iso: string) => new Date(iso);

describe("dhakaDayStart", () => {
  it("is the previous 18:00 UTC (local midnight, UTC+6)", () => {
    // 12:00 Dhaka on 12 Nov = 06:00 UTC on 12 Nov; midnight Dhaka = 18:00 UTC on 11 Nov.
    expect(dhakaDayStart(at("2026-11-12T06:00:00Z")).toISOString()).toBe(
      "2026-11-11T18:00:00.000Z",
    );
  });

  it("belongs to the next Dhaka day from 18:00 UTC", () => {
    expect(dhakaDayStart(at("2026-11-12T17:59:59.999Z")).toISOString()).toBe(
      "2026-11-11T18:00:00.000Z",
    );
    expect(dhakaDayStart(at("2026-11-12T18:00:00Z")).toISOString()).toBe(
      "2026-11-12T18:00:00.000Z",
    );
  });

  it("is itself on the boundary", () => {
    const start = at("2026-11-11T18:00:00Z");
    expect(dhakaDayStart(start).getTime()).toBe(start.getTime());
  });

  it("crosses a month and a year boundary", () => {
    expect(dhakaDayStart(at("2026-12-31T20:00:00Z")).toISOString()).toBe(
      "2026-12-31T18:00:00.000Z",
    );
    expect(dhakaDayStart(at("2027-01-01T05:00:00Z")).toISOString()).toBe(
      "2026-12-31T18:00:00.000Z",
    );
  });
});

describe("dhakaMonthStart", () => {
  it("is the first of the Dhaka month at local midnight", () => {
    expect(dhakaMonthStart(at("2026-11-12T06:00:00Z")).toISOString()).toBe(
      "2026-10-31T18:00:00.000Z",
    );
  });

  it("uses the Dhaka calendar, not UTC, around month end", () => {
    // 20:00 UTC on 30 Nov is already 1 Dec in Dhaka.
    expect(dhakaMonthStart(at("2026-11-30T20:00:00Z")).toISOString()).toBe(
      "2026-11-30T18:00:00.000Z",
    );
    // 17:59 UTC on 30 Nov is still 30 Nov in Dhaka.
    expect(dhakaMonthStart(at("2026-11-30T17:59:59Z")).toISOString()).toBe(
      "2026-10-31T18:00:00.000Z",
    );
  });

  it("handles January and leap-year February", () => {
    expect(dhakaMonthStart(at("2027-01-15T00:00:00Z")).toISOString()).toBe(
      "2026-12-31T18:00:00.000Z",
    );
    expect(dhakaMonthStart(at("2028-02-29T10:00:00Z")).toISOString()).toBe(
      "2028-01-31T18:00:00.000Z",
    );
  });
});
