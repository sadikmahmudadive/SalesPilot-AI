/**
 * Pure logic behind the agent editor: form values, converting them into an
 * API create/patch body, diffing edits into a minimal PATCH, and applying role templates.
 * No React dependencies; pure and unit-tested.
 */
import { stableJson } from "@/lib/stable-json";
import {
  DEFAULT_LIMITS,
  type Agent,
  type AgentChannel,
  type AgentInput,
  type AgentLanguage,
  type AgentPatch,
  type AgentRole,
  type AgentStatus,
  type ResponseStyle,
  type ToolName,
} from "@/schemas/agent";
import { AGENT_TEMPLATES } from "@/services/agents/templates";

export interface AgentFormValues {
  name: string;
  role: AgentRole;
  status: AgentStatus;
  description: string;
  personality: string;
  instructions: string;
  objectives: string[];
  languages: AgentLanguage[];
  tools: ToolName[];
  productAccessMode: "all" | "categories";
  productAccessCategoryIds: string[];
  channels: AgentChannel[];
  escalationKeywords: string[];
  escalationOnMissingInfo: boolean;
  escalationMaxTurnsBeforeHandover: string;
  limitsMaxTurnsPerSession: number;
  limitsMaxToolCallsPerTurn: number;
  limitsMaxOutputTokens: number;
  responseStyle: ResponseStyle;
  model: string;
}

export const DEFAULT_AGENT_FORM_VALUES: AgentFormValues = {
  name: "",
  role: "retail_sales",
  status: "inactive",
  description: "",
  personality: "",
  instructions: "",
  objectives: [],
  languages: ["bn", "en", "banglish"],
  tools: [],
  productAccessMode: "all",
  productAccessCategoryIds: [],
  channels: ["test"],
  escalationKeywords: [],
  escalationOnMissingInfo: true,
  escalationMaxTurnsBeforeHandover: "",
  limitsMaxTurnsPerSession: DEFAULT_LIMITS.maxTurnsPerSession,
  limitsMaxToolCallsPerTurn: DEFAULT_LIMITS.maxToolCallsPerTurn,
  limitsMaxOutputTokens: DEFAULT_LIMITS.maxOutputTokens,
  responseStyle: "concise",
  model: "",
};

export function agentToFormValues(agent: Agent): AgentFormValues {
  return {
    name: agent.name,
    role: agent.role,
    status: agent.status,
    description: agent.description ?? "",
    personality: agent.personality ?? "",
    instructions: agent.instructions ?? "",
    objectives: [...agent.objectives],
    languages: [...agent.languages],
    tools: [...agent.tools],
    productAccessMode: agent.productAccess.mode,
    productAccessCategoryIds:
      agent.productAccess.mode === "categories" ? [...agent.productAccess.categoryIds] : [],
    channels: [...agent.channels],
    escalationKeywords: [...agent.escalation.keywords],
    escalationOnMissingInfo: agent.escalation.onMissingInfo,
    escalationMaxTurnsBeforeHandover:
      agent.escalation.maxTurnsBeforeHandover !== undefined
        ? String(agent.escalation.maxTurnsBeforeHandover)
        : "",
    limitsMaxTurnsPerSession: agent.limits.maxTurnsPerSession,
    limitsMaxToolCallsPerTurn: agent.limits.maxToolCallsPerTurn,
    limitsMaxOutputTokens: agent.limits.maxOutputTokens,
    responseStyle: agent.responseStyle,
    model: agent.model ?? "",
  };
}

/**
 * Applies a role template to form values without overwriting fields that the user already edited.
 */
export function applyTemplate(values: AgentFormValues, role: AgentRole): AgentFormValues {
  const tmpl = AGENT_TEMPLATES[role];
  const prevTmpl = AGENT_TEMPLATES[values.role];

  const isUnedited = (current: string, prevTemplateVal: string) =>
    current.trim() === "" || current === prevTemplateVal;

  const next: AgentFormValues = {
    ...values,
    role,
  };

  if (isUnedited(values.description, prevTmpl?.description ?? "")) {
    next.description = tmpl.description;
  }
  if (isUnedited(values.personality, prevTmpl?.personality ?? "")) {
    next.personality = tmpl.personality;
  }
  if (isUnedited(values.instructions, prevTmpl?.instructions ?? "")) {
    next.instructions = tmpl.instructions;
  }
  if (
    values.objectives.length === 0 ||
    stableJson(values.objectives) === stableJson(prevTmpl?.objectives ?? [])
  ) {
    next.objectives = [...tmpl.objectives];
  }
  if (
    values.tools.length === 0 ||
    stableJson(values.tools) === stableJson(prevTmpl?.tools ?? [])
  ) {
    next.tools = [...tmpl.tools];
  }
  if (
    values.responseStyle === "concise" ||
    values.responseStyle === prevTmpl?.responseStyle
  ) {
    next.responseStyle = tmpl.responseStyle;
  }

  return next;
}

/**
 * Prepares an `AgentInput` payload from form values.
 */
export function prepareAgentBody(values: AgentFormValues): AgentInput {
  const escalationMaxTurns = values.escalationMaxTurnsBeforeHandover.trim()
    ? Number(values.escalationMaxTurnsBeforeHandover)
    : undefined;

  const productAccess =
    values.productAccessMode === "all"
      ? ({ mode: "all" } as const)
      : ({
          mode: "categories",
          categoryIds: values.productAccessCategoryIds,
        } as const);

  const body: AgentInput = {
    name: values.name.trim(),
    role: values.role,
    status: values.status,
    description: values.description.trim(),
    personality: values.personality.trim(),
    instructions: values.instructions.trim(),
    objectives: values.objectives.map((o) => o.trim()).filter((o) => o.length > 0),
    languages: values.languages,
    tools: values.tools,
    productAccess,
    channels: values.channels,
    escalation: {
      keywords: values.escalationKeywords.map((k) => k.trim()).filter((k) => k.length > 0),
      onMissingInfo: values.escalationOnMissingInfo,
      ...(escalationMaxTurns !== undefined && !Number.isNaN(escalationMaxTurns)
        ? { maxTurnsBeforeHandover: escalationMaxTurns }
        : {}),
    },
    limits: {
      maxTurnsPerSession: Number(values.limitsMaxTurnsPerSession),
      maxToolCallsPerTurn: Number(values.limitsMaxToolCallsPerTurn),
      maxOutputTokens: Number(values.limitsMaxOutputTokens),
    },
    responseStyle: values.responseStyle,
    ...(values.model.trim() ? { model: values.model.trim() } : {}),
  };

  return body;
}

const SCALAR_KEYS = [
  "name",
  "role",
  "status",
  "description",
  "personality",
  "instructions",
  "responseStyle",
] as const;

const WHOLE_KEYS = [
  "objectives",
  "languages",
  "tools",
  "productAccess",
  "channels",
  "escalation",
  "limits",
] as const;

/**
 * Produces a minimal PATCH body by comparing the initial baseline with the current form values.
 * Returns an empty object when no fields have changed.
 */
export function buildAgentPatch(baseline: AgentInput, values: AgentFormValues): AgentPatch {
  const next = prepareAgentBody(values);
  const patch: Record<string, unknown> = {};

  for (const key of SCALAR_KEYS) {
    if (baseline[key] !== next[key]) {
      patch[key] = next[key];
    }
  }

  for (const key of WHOLE_KEYS) {
    if (stableJson(baseline[key]) !== stableJson(next[key])) {
      patch[key] = next[key];
    }
  }

  // Handle clearable model
  const baseModel = baseline.model ?? "";
  const nextModel = next.model ?? "";
  if (baseModel !== nextModel) {
    patch.model = nextModel ? nextModel : null;
  }

  return patch as AgentPatch;
}
