import { describe, expect, it } from "vitest";

import { CONVERSATION_CHANNELS, CONVERSATION_STATUSES } from "@/schemas/inbox";

import {
  CONVERSATION_CHANNEL_LABELS,
  CONVERSATION_STATUS_LABELS,
  INBOX_FILTER_TABS,
  QUICK_REPLY_TEMPLATES,
  formatMessageDayGroup,
  formatRelativeActivity,
} from "./inbox-labels";

describe("inbox-labels", () => {
  it("has labels for every conversation status and channel", () => {
    for (const s of CONVERSATION_STATUSES) {
      expect(CONVERSATION_STATUS_LABELS[s]).toBeTruthy();
    }
    for (const c of CONVERSATION_CHANNELS) {
      expect(CONVERSATION_CHANNEL_LABELS[c]).toBeTruthy();
    }
    expect(INBOX_FILTER_TABS.map((t) => t.value)).toEqual([
      "all",
      "needs_reply",
      "ai_handling",
      "human_handling",
      "resolved",
    ]);
    expect(QUICK_REPLY_TEMPLATES.length).toBeGreaterThanOrEqual(3);
  });

  it("formats relative activity and message day groups cleanly", () => {
    const now = Date.parse("2026-11-13T10:00:00Z");
    expect(formatRelativeActivity("2026-11-13T09:59:30Z", now)).toBe("Just now");
    expect(formatRelativeActivity("2026-11-13T09:45:00Z", now)).toBe("15m ago");
    expect(formatRelativeActivity("2026-11-13T07:00:00Z", now)).toBe("3h ago");
    expect(formatRelativeActivity("2026-11-11T10:00:00Z", now)).toBe("2d ago");
    expect(formatRelativeActivity("not-a-date", now)).toBe("");

    expect(formatMessageDayGroup("2026-11-13T06:00:00Z", now)).toBe("Today");
    expect(formatMessageDayGroup("2026-11-12T06:00:00Z", now)).toBe("Yesterday");
    expect(formatMessageDayGroup("2026-11-01T06:00:00Z", now)).toContain("Nov");
  });
});
