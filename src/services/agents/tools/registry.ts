/**
 * Agent tool registry and executor. Server-only.
 *
 * `executeTool` is the single door between the model and the tools. Its order is fixed:
 *   1. allow-list: the name must be a known tool, listed in `agent.tools`, implemented, and the
 *      agent must belong to `ctx.organizationId` (else `denied`);
 *   2. parse: bounded size, valid JSON object (truncated / malformed arguments are `invalid`),
 *      `null` -> `undefined` recursively (strict mode sends `null` for omitted optionals), then
 *      the tool's Zod input schema (`invalid`);
 *   3. run the tool; its data is parsed through the tool's OUTPUT schema (strips undeclared keys,
 *      so an internal field can never leak);
 *   4. a thrown error becomes `failed`, logged with the tool name and an error code only.
 * Messages are static (see TOOL_MESSAGES): arguments are never echoed.
 *
 * CRM tools (lookup_customer, save_customer_info, escalate_to_human) are added to TOOL_REGISTRY
 * by a later task; until then they are allowed-but-unimplemented and execute as `denied`.
 */
import "server-only";

import { logger } from "@/lib/logger";
import { TOOL_NAMES, type Agent, type ToolName } from "@/schemas/agent";
import { toStrictJsonSchema } from "@/lib/ai/strict-schema";
import type { ToolSpec } from "@/lib/ai/provider";

import { checkStockTool } from "./check-stock";
import { getPriceTool } from "./get-price";
import { orderTotalTool } from "./order-total";
import { productDetailsTool } from "./product-details";
import { searchProductsTool } from "./search-products";
import { toolFailure, type AgentTool, type ToolContext, type ToolOutcome } from "./types";

export const TOOL_REGISTRY: Readonly<Partial<Record<ToolName, AgentTool<unknown, unknown>>>> =
  Object.freeze({
    search_products: searchProductsTool,
    get_product_details: productDetailsTool,
    get_price: getPriceTool,
    check_stock: checkStockTool,
    calculate_order_total: orderTotalTool,
  });

const isToolName = (name: string): name is ToolName =>
  (TOOL_NAMES as readonly string[]).includes(name);

/** The registered tool the agent may use, or undefined. */
function allowedTool(agent: Agent, name: string): AgentTool<unknown, unknown> | undefined {
  if (!isToolName(name) || !agent.tools.includes(name)) return undefined;
  return TOOL_REGISTRY[name];
}

/** Provider tool specs for the agent's allowed (and implemented) tools, strict schemas. */
export function toolSpecsFor(agent: Agent): ToolSpec[] {
  const specs: ToolSpec[] = [];
  for (const name of agent.tools) {
    const tool = TOOL_REGISTRY[name];
    if (!tool) continue;
    specs.push({
      name: tool.name,
      description: tool.description,
      parameters: toStrictJsonSchema(tool.input),
    });
  }
  return specs;
}

const MAX_ARGUMENT_CHARS = 20_000;
const MAX_ARGUMENT_DEPTH = 8;

class TooDeep extends Error {}

/**
 * Recursively turns `null` into `undefined` (object keys are dropped, array slots become
 * undefined) and drops `__proto__` keys. Throws `TooDeep` past MAX_ARGUMENT_DEPTH.
 */
export function normalizeNulls(value: unknown, depth = 0): unknown {
  if (value === null) return undefined;
  if (typeof value !== "object") return value;
  if (depth >= MAX_ARGUMENT_DEPTH) throw new TooDeep();
  if (Array.isArray(value)) return value.map((v) => normalizeNulls(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === "__proto__") continue;
    const normalized = normalizeNulls(v, depth + 1);
    if (normalized !== undefined) out[key] = normalized;
  }
  return out;
}

function parseArguments(argumentsJson: string): { ok: true; value: unknown } | { ok: false } {
  if (typeof argumentsJson !== "string" || argumentsJson.length > MAX_ARGUMENT_CHARS) {
    return { ok: false };
  }
  try {
    const raw: unknown = JSON.parse(argumentsJson);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false };
    return { ok: true, value: normalizeNulls(raw) };
  } catch {
    return { ok: false };
  }
}

function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" || typeof code === "number" ? String(code) : "unknown";
}

export async function executeTool(
  ctx: ToolContext,
  name: string,
  argumentsJson: string,
): Promise<ToolOutcome<unknown>> {
  const tool =
    ctx.agent.organizationId === ctx.organizationId ? allowedTool(ctx.agent, name) : undefined;
  if (!tool) return toolFailure("denied");

  const args = parseArguments(argumentsJson);
  if (!args.ok) return toolFailure("invalid");
  const input = tool.input.safeParse(args.value);
  if (!input.success) return toolFailure("invalid");

  try {
    const outcome = await tool.run(ctx, input.data);
    if (!outcome.ok) return outcome;
    const data = tool.output.safeParse(outcome.data);
    if (!data.success) {
      logger.error("agent tool output invalid", { tool: tool.name, code: "output_invalid" });
      return toolFailure("failed");
    }
    return outcome.dryRunAction
      ? { ok: true, data: data.data, dryRunAction: outcome.dryRunAction }
      : { ok: true, data: data.data };
  } catch (err) {
    logger.error("agent tool failed", { tool: tool.name, code: errorCode(err) });
    return toolFailure("failed");
  }
}
