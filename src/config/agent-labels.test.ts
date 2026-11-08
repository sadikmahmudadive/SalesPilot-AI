import { describe, expect, it } from "vitest";

import {
  AGENT_CHANNELS,
  AGENT_LANGUAGES,
  AGENT_ROLES,
  AGENT_STATUSES,
  RESPONSE_STYLES,
  TOOL_NAMES,
} from "@/schemas/agent";

import {
  AGENT_CHANNEL_LABELS,
  AGENT_LANGUAGE_LABELS,
  AGENT_ROLE_LABELS,
  AGENT_STATUS_LABELS,
  HUMAN_AGENT_ROLE_LABEL,
  RESPONSE_STYLE_LABELS,
  TOOL_LABELS,
} from "./agent-labels";

const keys = (o: object) => Object.keys(o).sort();

describe("agent labels", () => {
  it("has a non-empty label for every enum value and nothing else", () => {
    const cases: [object, readonly string[]][] = [
      [AGENT_ROLE_LABELS, AGENT_ROLES],
      [AGENT_LANGUAGE_LABELS, AGENT_LANGUAGES],
      [AGENT_CHANNEL_LABELS, AGENT_CHANNELS],
      [AGENT_STATUS_LABELS, AGENT_STATUSES],
      [RESPONSE_STYLE_LABELS, RESPONSE_STYLES],
      [TOOL_LABELS, TOOL_NAMES],
    ];
    for (const [labels, values] of cases) {
      expect(keys(labels)).toEqual([...values].sort());
    }
    for (const labels of [
      AGENT_ROLE_LABELS,
      AGENT_LANGUAGE_LABELS,
      AGENT_CHANNEL_LABELS,
      AGENT_STATUS_LABELS,
      RESPONSE_STYLE_LABELS,
    ] as Record<string, string>[]) {
      for (const v of Object.values(labels)) expect(v.length).toBeGreaterThan(0);
    }
    for (const t of Object.values(TOOL_LABELS)) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it("names the human role distinctly from AI agents", () => {
    expect(HUMAN_AGENT_ROLE_LABEL).toBe("Sales agent (team member)");
  });
});
