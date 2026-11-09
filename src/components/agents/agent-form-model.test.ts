import { describe, expect, it } from "vitest";

import { agentInputSchema } from "@/schemas/agent";
import { AGENT_TEMPLATES } from "@/services/agents/templates";

import {
  applyTemplate,
  buildAgentPatch,
  DEFAULT_AGENT_FORM_VALUES,
  prepareAgentBody,
  agentToFormValues,
  type AgentFormValues,
} from "./agent-form-model";

describe("agent-form-model", () => {
  it("prepareAgentBody parses with agentInputSchema", () => {
    const values: AgentFormValues = {
      ...DEFAULT_AGENT_FORM_VALUES,
      name: "   Store Assistant   ",
      description: "  Helping customers  ",
      personality: " Friendly ",
      instructions: " Do good ",
      objectives: [" Sell items "],
      model: " gpt-4o ",
    };

    const body = prepareAgentBody(values);
    expect(body.name).toBe("Store Assistant");
    expect(body.description).toBe("Helping customers");
    expect(body.personality).toBe("Friendly");
    expect(body.instructions).toBe("Do good");
    expect(body.objectives).toEqual(["Sell items"]);
    expect(body.model).toBe("gpt-4o");

    const validated = agentInputSchema.parse(body);
    expect(validated.name).toBe("Store Assistant");
  });

  it("applies template on role pick without overwriting fields the user already edited", () => {
    // Fresh defaults with user having edited personality and description
    const values: AgentFormValues = {
      ...DEFAULT_AGENT_FORM_VALUES,
      personality: "My custom personality",
      description: "My custom description",
    };

    const templated = applyTemplate(values, "wholesale_sales");
    expect(templated.role).toBe("wholesale_sales");
    // Preserves edited fields
    expect(templated.personality).toBe("My custom personality");
    expect(templated.description).toBe("My custom description");

    // Pre-fills empty fields from the wholesale_sales template
    const tmpl = AGENT_TEMPLATES.wholesale_sales;
    expect(templated.instructions).toBe(tmpl.instructions);
    expect(templated.objectives).toEqual([...tmpl.objectives]);
    expect(templated.tools).toEqual([...tmpl.tools]);
    expect(templated.responseStyle).toBe(tmpl.responseStyle);
  });

  it("buildAgentPatch returns empty object when nothing changed", () => {
    const values: AgentFormValues = {
      ...DEFAULT_AGENT_FORM_VALUES,
      name: "Original Bot",
      description: "Desc",
      personality: "Pers",
      instructions: "Inst",
    };
    const baseline = prepareAgentBody(values);
    const patch = buildAgentPatch(baseline, values);
    expect(patch).toEqual({});
  });

  it("buildAgentPatch sends only changed fields", () => {
    const values: AgentFormValues = {
      ...DEFAULT_AGENT_FORM_VALUES,
      name: "Original Bot",
      description: "Desc",
      personality: "Pers",
      instructions: "Inst",
    };
    const baseline = prepareAgentBody(values);

    // Change only personality
    const updatedValues: AgentFormValues = {
      ...values,
      personality: "Updated Pers",
    };
    const patch = buildAgentPatch(baseline, updatedValues);
    expect(patch).toEqual({ personality: "Updated Pers" });
  });

  it("buildAgentPatch produces { status } for status-only change", () => {
    const values: AgentFormValues = {
      ...DEFAULT_AGENT_FORM_VALUES,
      name: "Active Bot",
      status: "inactive",
    };
    const baseline = prepareAgentBody(values);

    const updatedValues: AgentFormValues = {
      ...values,
      status: "active",
    };
    const patch = buildAgentPatch(baseline, updatedValues);
    expect(patch).toEqual({ status: "active" });
  });

  it("buildAgentPatch sends tools, objectives, escalation, limits, productAccess whole when changed", () => {
    const values: AgentFormValues = {
      ...DEFAULT_AGENT_FORM_VALUES,
      name: "Complex Bot",
      tools: ["search_products"],
      objectives: ["Obj 1"],
      limitsMaxTurnsPerSession: 30,
      limitsMaxToolCallsPerTurn: 4,
      limitsMaxOutputTokens: 600,
    };
    const baseline = prepareAgentBody(values);

    const updatedValues: AgentFormValues = {
      ...values,
      tools: ["search_products", "get_price"],
      objectives: ["Obj 1", "Obj 2"],
      productAccessMode: "categories",
      productAccessCategoryIds: ["cat-1"],
      escalationKeywords: ["help"],
      limitsMaxTurnsPerSession: 40,
    };

    const patch = buildAgentPatch(baseline, updatedValues);
    expect(patch.tools).toEqual(["search_products", "get_price"]);
    expect(patch.objectives).toEqual(["Obj 1", "Obj 2"]);
    expect(patch.productAccess).toEqual({ mode: "categories", categoryIds: ["cat-1"] });
    expect(patch.escalation).toEqual({ keywords: ["help"], onMissingInfo: true });
    expect(patch.limits).toEqual({
      maxTurnsPerSession: 40,
      maxToolCallsPerTurn: 4,
      maxOutputTokens: 600,
    });
    // Name, personality, etc. were not changed so not in patch
    expect(patch.name).toBeUndefined();
  });

  it("clears model with null when cleared in form", () => {
    const values: AgentFormValues = {
      ...DEFAULT_AGENT_FORM_VALUES,
      name: "Model Bot",
      model: "gpt-4o",
    };
    const baseline = prepareAgentBody(values);

    const updatedValues: AgentFormValues = {
      ...values,
      model: "",
    };
    const patch = buildAgentPatch(baseline, updatedValues);
    expect(patch.model).toBeNull();
  });

  it("agentToFormValues maps an Agent accurately to form values", () => {
    const body = prepareAgentBody({
      ...DEFAULT_AGENT_FORM_VALUES,
      name: "Saved Bot",
      productAccessMode: "categories",
      productAccessCategoryIds: ["c1", "c2"],
      escalationKeywords: ["urgent"],
      escalationMaxTurnsBeforeHandover: "5",
      model: "gpt-4o",
    });

    const agent = {
      ...body,
      id: "agent-123",
      organizationId: "org-123",
      version: 1,
      createdBy: "uid-1",
      createdAt: "2026-11-10T00:00:00.000Z",
      updatedAt: "2026-11-10T00:00:00.000Z",
    };

    const formValues = agentToFormValues(agent);
    expect(formValues.name).toBe("Saved Bot");
    expect(formValues.productAccessMode).toBe("categories");
    expect(formValues.productAccessCategoryIds).toEqual(["c1", "c2"]);
    expect(formValues.escalationKeywords).toEqual(["urgent"]);
    expect(formValues.escalationMaxTurnsBeforeHandover).toBe("5");
    expect(formValues.model).toBe("gpt-4o");
  });
});
