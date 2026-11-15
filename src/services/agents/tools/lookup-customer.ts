/**
 * `lookup_customer`: does a customer with this phone number exist? Server-only.
 *
 * Returns only `{ exists, fullName?, segment? }`. The phone, email, address, notes and every
 * other field never reach the model. The lookup is scoped to `ctx.organizationId`. On live
 * channels it only answers for the conversing customer's own number (`contactPhoneE164`).
 */
import "server-only";

import { z } from "zod";

import { CUSTOMER_SEGMENTS } from "@/schemas/customer";

import { CONTACT_DENIED, findCustomerByPhone, mayAccessPhone, phoneE164Of } from "./crm-access";
import { defineTool, toolFailure, type ToolContext, type ToolOutcome } from "./types";

const inputSchema = z.object({
  phone: z
    .string()
    .min(1)
    .max(64)
    .describe(
      "The customer's mobile number, in any common format (01XXXXXXXXX or +8801XXXXXXXXX).",
    ),
});
type LookupInput = z.output<typeof inputSchema>;

const outputSchema = z.object({
  exists: z.boolean(),
  fullName: z.string().optional(),
  segment: z.enum(CUSTOMER_SEGMENTS).optional(),
});
type LookupOutput = z.output<typeof outputSchema>;

async function run(ctx: ToolContext, input: LookupInput): Promise<ToolOutcome<LookupOutput>> {
  const phoneE164 = phoneE164Of(input.phone);
  if (!phoneE164) return toolFailure("invalid", "That phone number isn't valid.");
  if (!mayAccessPhone(ctx, phoneE164)) return toolFailure("denied", CONTACT_DENIED);
  const customer = await findCustomerByPhone(ctx.organizationId, phoneE164);
  if (!customer) return { ok: true, data: { exists: false } };
  return {
    ok: true,
    data: { exists: true, fullName: customer.fullName, segment: customer.segment },
  };
}

export const lookupCustomerTool = defineTool<LookupInput, LookupOutput>({
  name: "lookup_customer",
  description:
    "Check whether a customer with a phone number is already known. Returns whether they exist " +
    "and, if so, their name and segment. Use it before saving customer details.",
  input: inputSchema,
  output: outputSchema,
  writes: false,
  run,
});
