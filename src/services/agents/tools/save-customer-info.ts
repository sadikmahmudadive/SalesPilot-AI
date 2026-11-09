/**
 * `save_customer_info`: capture or update a customer from the conversation. Server-only.
 *
 * FLOW. The phone (normalised to E.164) finds the organization's customer through the phone lock.
 *   - Found  -> UPDATE with only the fields the model provided (`customerPatchSchema`).
 *   - Absent -> CREATE (`customerInputSchema`); a `fullName` is required, else `invalid`.
 * Blank strings are treated as "not provided" (a blank must never clear a stored field), so
 * the tool never clears anything.
 *
 * NOTES. `notes` is stored as `preferences.notes`. The customer PATCH replaces the WHOLE
 * `preferences` map, so on update the stored `language` is read and sent back with the new
 * note, otherwise saving a note would silently drop it.
 *
 * CHANNEL. `ctx.channel === "test"` runs the same parsing and returns a `dryRunAction` without
 * any write. `whatsapp` / `voice` call `createCustomer` / `updateCustomer` with the audit actor
 * `ai-agent:{agentId}`; the services keep their tenancy, uniqueness and audit rules.
 *
 * PII. Failures are static and never echo the input; nothing here is logged.
 */
import "server-only";

import { z } from "zod";

import {
  CUSTOMER_SEGMENTS,
  customerInputSchema,
  customerPatchSchema,
  type CustomerInput,
  type CustomerPatch,
} from "@/schemas/customer";
import { createCustomer, updateCustomer } from "@/services/crm/customers";

import { findCustomerByPhone, phoneE164Of } from "./crm-access";
import {
  defineTool,
  toolFailure,
  type DryRunAction,
  type ToolContext,
  type ToolOutcome,
} from "./types";

const inputSchema = z.object({
  phone: z
    .string()
    .min(1)
    .max(64)
    .describe("The customer's mobile number (01XXXXXXXXX or +8801XXXXXXXXX)."),
  fullName: z
    .string()
    .max(200)
    .optional()
    .describe("The customer's name. Required for a new customer."),
  address: z.string().max(600).optional(),
  email: z.string().max(254).optional(),
  notes: z
    .string()
    .max(1000)
    .optional()
    .describe("Short note about the customer's needs or preferences."),
  segment: z
    .enum(CUSTOMER_SEGMENTS)
    .optional()
    .describe("Where the customer is in the sales funnel."),
});
type SaveInput = z.output<typeof inputSchema>;

const outputSchema = z.object({
  action: z.enum(["create", "update"]),
  customerId: z.string().optional(),
});
type SaveOutput = z.output<typeof outputSchema>;

const NAME_NEEDED = "A name is needed to create a new customer.";
const BAD_PHONE = "That phone number isn't valid.";
const BAD_DETAILS = "Some of the customer details were invalid.";
const NOTHING_NEW = "There is nothing new to save.";

/** Keys derived or maintained by the service: never part of what the tool reports. */
const INTERNAL_KEYS = new Set(["phoneE164", "whatsappE164", "tagsLower", "fullNameLower"]);

function dryRun(kind: DryRunAction["kind"], parsed: object): DryRunAction {
  const fields = Object.entries(parsed).filter(([key]) => !INTERNAL_KEYS.has(key));
  return { kind, fields: Object.fromEntries(fields) };
}

/** The trimmed string, or undefined when it is missing or blank. */
function provided(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function run(ctx: ToolContext, input: SaveInput): Promise<ToolOutcome<SaveOutput>> {
  const phoneE164 = phoneE164Of(input.phone);
  if (!phoneE164) return toolFailure("invalid", BAD_PHONE);

  const fullName = provided(input.fullName);
  const address = provided(input.address);
  const email = provided(input.email);
  const notes = provided(input.notes);
  const segment = input.segment;
  const test = ctx.channel === "test";
  const audit = { organizationId: ctx.organizationId, uid: `ai-agent:${ctx.agent.id}` };

  const existing = await findCustomerByPhone(ctx.organizationId, phoneE164);

  if (existing) {
    const raw: Record<string, unknown> = {};
    if (fullName !== undefined) raw.fullName = fullName;
    if (address !== undefined) raw.address = address;
    if (email !== undefined) raw.email = email;
    if (segment !== undefined) raw.segment = segment;
    if (notes !== undefined) {
      // The patch replaces the whole preferences map: carry the stored language over.
      raw.preferences = { language: existing.preferences?.language, notes };
    }
    if (Object.keys(raw).length === 0) return toolFailure("invalid", NOTHING_NEW);
    const parsed = customerPatchSchema.safeParse(raw);
    if (!parsed.success) return toolFailure("invalid", BAD_DETAILS);
    const patch: CustomerPatch = parsed.data;
    if (test) {
      return {
        ok: true,
        data: { action: "update" },
        dryRunAction: dryRun("update_customer", patch),
      };
    }
    await updateCustomer(audit, existing.id, patch);
    return { ok: true, data: { action: "update", customerId: existing.id } };
  }

  if (fullName === undefined) return toolFailure("invalid", NAME_NEEDED);
  const raw: Record<string, unknown> = { phone: input.phone, fullName };
  if (address !== undefined) raw.address = address;
  if (email !== undefined) raw.email = email;
  if (segment !== undefined) raw.segment = segment;
  if (notes !== undefined) raw.preferences = { notes };
  const parsed = customerInputSchema.safeParse(raw);
  if (!parsed.success) return toolFailure("invalid", BAD_DETAILS);
  const customer: CustomerInput = parsed.data;
  if (test) {
    return {
      ok: true,
      data: { action: "create" },
      dryRunAction: dryRun("create_customer", customer),
    };
  }
  const created = await createCustomer(audit, customer);
  return { ok: true, data: { action: "create", customerId: created.id } };
}

export const saveCustomerInfoTool = defineTool<SaveInput, SaveOutput>({
  name: "save_customer_info",
  description:
    "Save what the customer told you: their phone number (required), and optionally name, " +
    "address, email, notes and sales segment. Updates the customer if the phone is already known, " +
    "otherwise creates one (a name is then required). Only send details the customer actually gave.",
  input: inputSchema,
  output: outputSchema,
  writes: true,
  run,
});
