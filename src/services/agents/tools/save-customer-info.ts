/**
 * `save_customer_info`: capture or update a customer from the conversation. Server-only.
 *
 * FLOW. The phone (normalised to E.164) finds the organization's customer through the phone lock.
 *   - Found  -> UPDATE with only the fields the model provided (`customerPatchSchema`).
 *   - Absent -> CREATE (`customerInputSchema`); a `fullName` is required, else `invalid`.
 * Blank strings are treated as "not provided" (a blank must never clear a stored field), so
 * the tool never clears anything.
 *
 * NOTES. `notes` is APPENDED to `preferences.notes` as a dated line `[AI YYYY-MM-DD] text`
 * (see ai-notes.ts; oldest lines drop first past 1000 characters): the model cannot see the
 * stored notes, so it must never overwrite human-written text. The customer PATCH replaces the
 * WHOLE `preferences` map, so on update the merged notes and the stored `language` are sent
 * together. The dry run reports only the new entry as `notes`.
 *
 * CHANNEL. Only `LIVE_CHANNELS` (`whatsapp`, `voice`) write, calling `createCustomer` /
 * `updateCustomer` with the audit actor `ai-agent:{agentId}`; every other channel (`test`)
 * runs the same parsing and returns a `dryRunAction` without any write.
 *
 * BINDING. On live channels the phone must equal `ctx.contactPhoneE164` (else `denied`), and
 * only forward-funnel segments may be set (else `invalid`).
 *
 * RACE. If a live create loses the race for the same number (ConflictError), the lookup is
 * repeated once and the call is retried as an update.
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
  type CustomerSegment,
} from "@/schemas/customer";
import { ConflictError } from "@/lib/errors";
import type { CustomerDoc } from "@/repositories/customers";
import { createCustomer, updateCustomer } from "@/services/crm/customers";

import { AI_NOTE_INPUT_MAX, aiNoteEntry, appendAiNote } from "./ai-notes";
import { CONTACT_DENIED, findCustomerByPhone, mayAccessPhone, phoneE164Of } from "./crm-access";
import {
  defineTool,
  isLiveChannel,
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
    .max(AI_NOTE_INPUT_MAX)
    .optional()
    .describe(
      "Short note about the customer's needs or preferences. It is appended, never replaces earlier notes.",
    ),
  segment: z
    .enum(CUSTOMER_SEGMENTS)
    .optional()
    .describe(
      "Sales funnel stage: only new_lead, interested, qualified_lead or potential_buyer can be set by you.",
    ),
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
const SEGMENT_DENIED = "That segment can't be set by the assistant.";

/** Forward-funnel segments only; the rest (converted, repeat, wholesale, inactive) are human decisions. */
const AI_SEGMENTS: ReadonlySet<CustomerSegment> = new Set<CustomerSegment>([
  "new_lead",
  "interested",
  "qualified_lead",
  "potential_buyer",
]);

/** Keys derived or maintained by the service: never part of what the tool reports. */
const INTERNAL_KEYS = new Set(["phoneE164", "whatsappE164", "tagsLower", "fullNameLower"]);

function dryRun(kind: DryRunAction["kind"], fields: Record<string, unknown>): DryRunAction {
  const entries = Object.entries(fields).filter(([key]) => !INTERNAL_KEYS.has(key));
  return { kind, fields: Object.fromEntries(entries) };
}

/** The trimmed string, or undefined when it is missing or blank. */
function provided(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

interface Details {
  phone: string;
  fullName?: string;
  address?: string;
  email?: string;
  /** The dated AI note entry (`[AI date] text`), not the stored notes. */
  noteEntry?: string;
  segment?: CustomerSegment;
}

type Run = Promise<ToolOutcome<SaveOutput>>;

async function update(ctx: ToolContext, existing: CustomerDoc, d: Details, live: boolean): Run {
  const raw: Record<string, unknown> = {};
  if (d.fullName !== undefined) raw.fullName = d.fullName;
  if (d.address !== undefined) raw.address = d.address;
  if (d.email !== undefined) raw.email = d.email;
  if (d.segment !== undefined) raw.segment = d.segment;
  if (d.noteEntry !== undefined) {
    // APPEND to the stored notes (the model cannot see them); the patch replaces the whole
    // preferences map, so the stored language is carried over too.
    raw.preferences = {
      language: existing.preferences?.language,
      notes: appendAiNote(existing.preferences?.notes, d.noteEntry),
    };
  }
  if (Object.keys(raw).length === 0) return toolFailure("invalid", NOTHING_NEW);
  const parsed = customerPatchSchema.safeParse(raw);
  if (!parsed.success) return toolFailure("invalid", BAD_DETAILS);
  const patch: CustomerPatch = parsed.data;
  if (!live) {
    // Report only the provided change: the new note entry, not the stored notes / language.
    const { preferences, ...rest } = patch as Record<string, unknown>;
    const fields =
      d.noteEntry !== undefined && preferences ? { ...rest, notes: d.noteEntry } : rest;
    return {
      ok: true,
      data: { action: "update" },
      dryRunAction: dryRun("update_customer", fields),
    };
  }
  await updateCustomer(auditCtx(ctx), existing.id, patch);
  return { ok: true, data: { action: "update", customerId: existing.id } };
}

const auditCtx = (ctx: ToolContext) => ({
  organizationId: ctx.organizationId,
  uid: `ai-agent:${ctx.agent.id}`,
});

async function create(ctx: ToolContext, d: Details, live: boolean): Run {
  if (d.fullName === undefined) return toolFailure("invalid", NAME_NEEDED);
  const raw: Record<string, unknown> = { phone: d.phone, fullName: d.fullName };
  if (d.address !== undefined) raw.address = d.address;
  if (d.email !== undefined) raw.email = d.email;
  if (d.segment !== undefined) raw.segment = d.segment;
  if (d.noteEntry !== undefined) raw.preferences = { notes: d.noteEntry };
  const parsed = customerInputSchema.safeParse(raw);
  if (!parsed.success) return toolFailure("invalid", BAD_DETAILS);
  const customer: CustomerInput = parsed.data;
  if (!live) {
    return {
      ok: true,
      data: { action: "create" },
      dryRunAction: dryRun("create_customer", customer),
    };
  }
  try {
    const created = await createCustomer(auditCtx(ctx), customer);
    return { ok: true, data: { action: "create", customerId: created.id } };
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err;
    // Another request took this number between our lookup and the write: retry once as an update.
    const winner = await findCustomerByPhone(ctx.organizationId, customer.phoneE164);
    if (!winner) throw err;
    return update(ctx, winner, d, true);
  }
}

async function run(ctx: ToolContext, input: SaveInput): Run {
  const phoneE164 = phoneE164Of(input.phone);
  if (!phoneE164) return toolFailure("invalid", BAD_PHONE);
  if (!mayAccessPhone(ctx, phoneE164)) return toolFailure("denied", CONTACT_DENIED);
  if (input.segment !== undefined && !AI_SEGMENTS.has(input.segment)) {
    return toolFailure("invalid", SEGMENT_DENIED);
  }

  // Only the explicit live channels write; anything else is a dry run.
  const live = isLiveChannel(ctx.channel);
  const notes = provided(input.notes);
  const details: Details = {
    phone: input.phone,
    fullName: provided(input.fullName),
    address: provided(input.address),
    email: provided(input.email),
    noteEntry: notes === undefined ? undefined : aiNoteEntry(notes),
    segment: input.segment,
  };

  const existing = await findCustomerByPhone(ctx.organizationId, phoneE164);
  return existing ? update(ctx, existing, details, live) : create(ctx, details, live);
}

export const saveCustomerInfoTool = defineTool<SaveInput, SaveOutput>({
  name: "save_customer_info",
  description:
    "Save what the customer told you: their phone number (required), and optionally name, " +
    "address, email, notes and sales segment. Updates the customer if the phone is already known, " +
    "otherwise creates one (a name is then required). Only send details the customer actually gave. On WhatsApp or voice it works only for the customer in this conversation. You may only set the segments new_lead, interested, qualified_lead and potential_buyer.",
  input: inputSchema,
  output: outputSchema,
  writes: true,
  run,
});
