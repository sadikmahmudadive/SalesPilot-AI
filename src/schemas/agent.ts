/**
 * AI agent schemas. Pure (shared by API routes, services and the UI).
 *
 * CREATE vs PATCH. `agentInputSchema` applies defaults (a new agent starts `inactive`, answers in
 * all three languages, has no tools, `{ mode: "all" }` product access and the `test` channel only).
 * `agentPatchSchema` shares the same field rules but applies NO top-level defaults, so patching
 * `{ name }` yields exactly `{ name }`; `status` and `role` are patchable; an empty patch is rejected.
 * Nested objects (`escalation`, `limits`, `productAccess`) are replaced WHOLESALE by a patch and
 * carry no defaults there: a `limits` patch must give all three limits, and an `escalation` patch
 * replaces the whole object, so omitting `maxTurnsBeforeHandover` clears it. `role` is a label and
 * template choice, not a behaviour field, so it is not in `VERSIONED_FIELDS`.
 *
 * MANAGED FIELDS. `id`, `organizationId`, `version`, `createdBy`, `createdAt`, `updatedAt` and
 * `nameLower` are never read from a client: object schemas strip unknown keys and the service
 * computes them. Error messages are static and never echo the submitted value.
 *
 * Source hygiene: no literal non-ASCII characters in this file.
 */
import { z } from "zod";

import { isValidIdSegment } from "@/lib/ids";
import { cleanName, isBlank } from "@/lib/text";

import { clearable, dropUndefined, omitWhenBlank } from "./helpers";

export const AGENT_ROLES = [
  "retail_sales",
  "wholesale_sales",
  "customer_support",
  "order_management",
  "voice_sales",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_LANGUAGES = ["bn", "en", "banglish"] as const;
export type AgentLanguage = (typeof AGENT_LANGUAGES)[number];

export const AGENT_CHANNELS = ["test", "whatsapp", "voice"] as const;
export type AgentChannel = (typeof AGENT_CHANNELS)[number];

export const AGENT_STATUSES = ["active", "inactive"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const RESPONSE_STYLES = ["concise", "detailed"] as const;
export type ResponseStyle = (typeof RESPONSE_STYLES)[number];

export const TOOL_NAMES = [
  "search_products",
  "get_product_details",
  "get_price",
  "check_stock",
  "calculate_order_total",
  "lookup_customer",
  "save_customer_info",
  "escalate_to_human",
  "create_draft_order",
  "update_draft_order",
  "confirm_order",
  "get_my_order_status",
  "send_payment_link",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Tools that change data on live channels (dry-run on the test channel). */
export const WRITE_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  "save_customer_info",
  "escalate_to_human",
  "create_draft_order",
  "update_draft_order",
  "confirm_order",
  "send_payment_link",
]);

/** Fields whose change bumps the agent `version`. Name, description and status do not. */
export const VERSIONED_FIELDS = [
  "personality",
  "instructions",
  "objectives",
  "languages",
  "tools",
  "productAccess",
  "escalation",
  "limits",
  "responseStyle",
  "model",
] as const;
export type VersionedField = (typeof VERSIONED_FIELDS)[number];

export const MAX_OBJECTIVES = 10;
export const MAX_CATEGORY_IDS = 20;
export const MAX_ESCALATION_KEYWORDS = 20;

const NAME_MESSAGE = "Enter the agent name (up to 80 characters)";
const isUnique = (list: readonly unknown[]): boolean => new Set(list).size === list.length;

/** A trimmed, non-blank string of at most `max` characters. */
const boundedText = (max: number, message: string) =>
  z
    .string({ error: message })
    .trim()
    .min(1, { error: message })
    .max(max, { error: message })
    .refine((v) => !isBlank(v), { error: message });

const nameCore = z
  .string({ error: NAME_MESSAGE })
  .max(1000, { error: NAME_MESSAGE })
  .transform(cleanName)
  .pipe(
    z
      .string()
      .min(1, { error: NAME_MESSAGE })
      .max(80, { error: NAME_MESSAGE })
      .refine((v) => !isBlank(v), { error: NAME_MESSAGE }),
  );

const longText = (max: number, message: string) =>
  z.string({ error: message }).trim().max(max, { error: message });

const objectivesSchema = z
  .array(boundedText(200, "Each objective needs 1-200 characters"), {
    error: "Objectives must be a list",
  })
  .max(MAX_OBJECTIVES, { error: `Use at most ${MAX_OBJECTIVES} objectives` });

const languagesSchema = z
  .array(z.enum(AGENT_LANGUAGES, { error: "Choose a supported language" }), {
    error: "Languages must be a list",
  })
  .min(1, { error: "Choose at least one language" })
  .refine(isUnique, { error: "Each language can be chosen only once" });

const toolsSchema = z
  .array(z.enum(TOOL_NAMES, { error: "Choose a supported tool" }), {
    error: "Tools must be a list",
  })
  .refine(isUnique, { error: "Each tool can be chosen only once" });

const categoryIdSchema = z
  .string({ error: "Choose a valid category" })
  .refine((v) => isValidIdSegment(v), { error: "Choose a valid category" });

const productAccessSchema = z.discriminatedUnion(
  "mode",
  [
    z.object({ mode: z.literal("all") }),
    z.object({
      mode: z.literal("categories"),
      categoryIds: z
        .array(categoryIdSchema, { error: "Categories must be a list" })
        .min(1, { error: "Choose at least one category" })
        .max(MAX_CATEGORY_IDS, { error: `Choose at most ${MAX_CATEGORY_IDS} categories` })
        .refine(isUnique, { error: "Each category can be chosen only once" }),
    }),
  ],
  { error: "Choose which products the agent can use" },
);

const channelsSchema = z
  .array(z.enum(AGENT_CHANNELS, { error: "Choose a supported channel" }), {
    error: "Channels must be a list",
  })
  .refine(isUnique, { error: "Each channel can be chosen only once" })
  .refine((list) => list.includes("test"), { error: "The test channel must stay enabled" });

const escalationSchema = z
  .object({
    keywords: z
      .array(boundedText(40, "Each keyword needs 1-40 characters"), {
        error: "Keywords must be a list",
      })
      .max(MAX_ESCALATION_KEYWORDS, {
        error: `Use at most ${MAX_ESCALATION_KEYWORDS} keywords`,
      }),
    onMissingInfo: z.boolean({ error: "Choose yes or no" }),
    maxTurnsBeforeHandover: z
      .number({ error: "Enter a whole number from 1 to 50" })
      .int({ error: "Enter a whole number from 1 to 50" })
      .min(1, { error: "Enter a whole number from 1 to 50" })
      .max(50, { error: "Enter a whole number from 1 to 50" })
      .optional(),
  })
  .transform((v) => dropUndefined(v));

export const DEFAULT_LIMITS = {
  maxTurnsPerSession: 30,
  maxToolCallsPerTurn: 4,
  maxOutputTokens: 600,
} as const;

const intInRange = (min: number, max: number) => {
  const message = `Enter a whole number from ${min} to ${max}`;
  return z
    .number({ error: message })
    .int({ error: message })
    .min(min, { error: message })
    .max(max, { error: message });
};

/** The limits shape, defined once with NO defaults (the PATCH form: all three are required). */
const limitsFields = {
  maxTurnsPerSession: intInRange(1, 100),
  maxToolCallsPerTurn: intInRange(1, 6),
  maxOutputTokens: intInRange(100, 2000),
};
const limitsSchema = z.object(limitsFields);
/** Create form: the same fields with per-field defaults. */
const limitsWithDefaultsSchema = z.object({
  maxTurnsPerSession: limitsFields.maxTurnsPerSession.default(DEFAULT_LIMITS.maxTurnsPerSession),
  maxToolCallsPerTurn: limitsFields.maxToolCallsPerTurn.default(DEFAULT_LIMITS.maxToolCallsPerTurn),
  maxOutputTokens: limitsFields.maxOutputTokens.default(DEFAULT_LIMITS.maxOutputTokens),
});

const modelCore = z.string().trim().min(1).max(100, { error: "Use 100 characters or fewer" });

const roleSchema = z.enum(AGENT_ROLES, { error: "Choose a role" });

/** Rules shared verbatim by create and PATCH. None of them carries a default. */
const sharedFields = {
  name: nameCore,
  status: z.enum(AGENT_STATUSES, { error: "Choose active or inactive" }),
  description: longText(500, "Use 500 characters or fewer"),
  personality: longText(1000, "Use 1000 characters or fewer"),
  instructions: longText(8000, "Use 8000 characters or fewer"),
  objectives: objectivesSchema,
  languages: languagesSchema,
  tools: toolsSchema,
  productAccess: productAccessSchema,
  channels: channelsSchema,
  escalation: escalationSchema,
  limits: limitsSchema,
  responseStyle: z.enum(RESPONSE_STYLES, { error: "Choose a response style" }),
};

/**
 * Create body. A new agent starts `inactive`; `test` is its only channel until the live channels
 * ship. Unknown and managed keys are stripped.
 */
export const agentInputSchema = z
  .object({
    name: sharedFields.name,
    role: roleSchema,
    status: sharedFields.status.default("inactive"),
    description: sharedFields.description.default(""),
    personality: sharedFields.personality.default(""),
    instructions: sharedFields.instructions.default(""),
    objectives: sharedFields.objectives.default([]),
    languages: sharedFields.languages.default([...AGENT_LANGUAGES]),
    tools: sharedFields.tools.default([]),
    productAccess: sharedFields.productAccess.default({ mode: "all" }),
    channels: sharedFields.channels.default(["test"]),
    escalation: sharedFields.escalation.default({ keywords: [], onMissingInfo: true }),
    limits: limitsWithDefaultsSchema.default({ ...DEFAULT_LIMITS }),
    responseStyle: sharedFields.responseStyle.default("concise"),
    model: omitWhenBlank(modelCore, "Use 100 characters or fewer"),
  })
  .transform((v) => dropUndefined(v));

/**
 * PATCH body. Every field optional, NO top-level defaults. `model` is clearable: `null` (or a
 * blank string) parses to `null`, which the service maps to `FieldValue.delete()`. An empty
 * patch (after stripping unknown keys) is rejected.
 */
export const agentPatchSchema = z
  .object({
    name: sharedFields.name,
    role: roleSchema,
    status: sharedFields.status,
    description: sharedFields.description,
    personality: sharedFields.personality,
    instructions: sharedFields.instructions,
    objectives: sharedFields.objectives,
    languages: sharedFields.languages,
    tools: sharedFields.tools,
    productAccess: sharedFields.productAccess,
    channels: sharedFields.channels,
    escalation: sharedFields.escalation,
    limits: sharedFields.limits,
    responseStyle: sharedFields.responseStyle,
    model: clearable(modelCore),
  })
  .partial()
  .transform((v) => dropUndefined(v))
  .refine((v) => Object.keys(v).length > 0, { error: "At least one field is required" });

export type AgentInput = z.output<typeof agentInputSchema>;
export type AgentPatch = z.output<typeof agentPatchSchema>;

/** A persisted agent (service-computed `nameLower` is not part of it). */
export type Agent = AgentInput & {
  id: string;
  organizationId: string;
  /** Starts at 1; bumped when a versioned field changes. */
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
