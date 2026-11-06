import { describe, expect, it } from "vitest";

import {
  CONSENT_LABELS,
  CONSENT_VARIANTS,
  SEGMENT_LABELS,
  SEGMENT_VARIANTS,
  TYPE_LABELS,
} from "@/config/customer-labels";
import { CONSENT_STATUSES, CUSTOMER_SEGMENTS, CUSTOMER_TYPES } from "@/schemas/customer";

describe("customer labels", () => {
  it("covers every segment, type and consent status with a non-empty label", () => {
    for (const s of CUSTOMER_SEGMENTS) {
      expect(SEGMENT_LABELS[s]).toBeTruthy();
      expect(SEGMENT_VARIANTS[s]).toBeTruthy();
    }
    for (const t of CUSTOMER_TYPES) expect(TYPE_LABELS[t]).toBeTruthy();
    for (const c of CONSENT_STATUSES) {
      expect(CONSENT_LABELS[c]).toBeTruthy();
      expect(CONSENT_VARIANTS[c]).toBeTruthy();
    }
  });

  it("has no extra keys beyond the schema enums", () => {
    expect(Object.keys(SEGMENT_LABELS).sort()).toEqual([...CUSTOMER_SEGMENTS].sort());
    expect(Object.keys(TYPE_LABELS).sort()).toEqual([...CUSTOMER_TYPES].sort());
    expect(Object.keys(CONSENT_LABELS).sort()).toEqual([...CONSENT_STATUSES].sort());
  });
});
