import { z } from "zod";

import { isValidIdSegment } from "@/lib/ids";
import { normalizePhone } from "@/lib/phone";

export const CUSTOMER_SEGMENTS = [
  "new_lead",
  "interested",
  "qualified_lead",
  "potential_buyer",
  "converted",
  "repeat_customer",
  "wholesale_customer",
  "inactive",
] as const;
export const CUSTOMER_TYPES = ["retail", "wholesale"] as const;
export const CONSENT_STATUSES = ["granted", "denied", "unknown"] as const;

export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];
export type CustomerType = (typeof CUSTOMER_TYPES)[number];
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

const MAX_TAGS = 20;
/** Hard cap on the raw tag array, so de-duplication never works on an unbounded list. */
const MAX_RAW_TAGS = 100;

// All messages are static: they never echo the submitted value (it may be PII).
const PHONE_MESSAGE = "Enter a valid mobile number";
const EMAIL_MESSAGE = "Enter a valid email address";

/** Case-insensitive de-duplication that keeps the first spelling and original order. */
function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Blank (after trimming) optional string -> undefined, so it is omitted from the output. */
const blankToUndefined = (v: string) => (v === "" ? undefined : v);

const phoneField = z
  .string({ error: PHONE_MESSAGE })
  .trim()
  .refine((v) => normalizePhone(v) !== null, { error: PHONE_MESSAGE });

const optionalPhoneField = z
  .string({ error: PHONE_MESSAGE })
  .trim()
  .transform(blankToUndefined)
  .pipe(phoneField.optional())
  .optional();

const consentSchema = z
  .object({
    status: z.enum(CONSENT_STATUSES, { error: "Choose a consent status" }),
    at: z.iso.datetime({ offset: true, error: "Enter a valid date and time" }).optional(),
    source: z
      .string()
      .trim()
      .min(1, "Enter where consent was obtained")
      .max(80, "Use 80 characters or fewer")
      .optional(),
  })
  .refine((c) => c.status !== "granted" || c.source !== undefined, {
    path: ["source"],
    error: "Record how consent was obtained",
  });

/**
 * Field definitions shared by the create (`customerInputSchema`) and PATCH
 * (`customerPatchSchema`) schemas, so validation rules live in one place. None of them
 * carries a default: defaults are applied only by the create schema.
 */
const fields = {
  fullName: z
    .string({ error: "Enter the customer's name" })
    .normalize("NFC")
    .trim()
    .min(1, "Enter the customer's name")
    .max(120, "Use 120 characters or fewer"),
  phone: phoneField,
  whatsappNumber: optionalPhoneField,
  email: z
    .string({ error: EMAIL_MESSAGE })
    .trim()
    .toLowerCase()
    .transform(blankToUndefined)
    .pipe(z.email({ error: EMAIL_MESSAGE }).optional())
    .optional(),
  address: z.string().trim().max(500, "Use 500 characters or fewer").optional(),
  customerType: z.enum(CUSTOMER_TYPES, { error: "Choose a customer type" }),
  leadSource: z.string().trim().max(80, "Use 80 characters or fewer").optional(),
  tags: z
    .array(
      z.string().trim().min(1, "Tags cannot be empty").max(40, "Use 40 characters or fewer per tag"),
      { error: "Tags must be a list" },
    )
    .max(MAX_RAW_TAGS, `Use at most ${MAX_TAGS} tags`)
    .transform(dedupeTags)
    .pipe(z.array(z.string()).max(MAX_TAGS, `Use at most ${MAX_TAGS} tags`)),
  segment: z.enum(CUSTOMER_SEGMENTS, { error: "Choose a segment" }),
  preferences: z
    .object({
      language: z.enum(["bn", "en", "mixed"], { error: "Choose a language" }).optional(),
      notes: z.string().trim().max(1000, "Use 1000 characters or fewer").optional(),
    })
    .optional(),
  assignedAgentId: z
    .string()
    .refine((v) => isValidIdSegment(v), { error: "Choose a valid agent" })
    .optional(),
  consent: consentSchema,
};

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/**
 * Adds the derived E.164 fields. They are computed only here, never read from client
 * input (the object schemas strip unknown keys, including `phoneE164`/`whatsappE164`).
 */
function withDerivedPhones<T extends { phone?: string; whatsappNumber?: string }>(
  value: T,
): T & { phoneE164?: string; whatsappE164?: string } {
  const out: T & { phoneE164?: string; whatsappE164?: string } = { ...value };
  if (value.phone !== undefined) out.phoneE164 = normalizePhone(value.phone) ?? undefined;
  if (value.whatsappNumber !== undefined) out.whatsappE164 = normalizePhone(value.whatsappNumber) ?? undefined;
  return dropUndefined(out);
}

/**
 * Create body. Applies defaults (retail / new_lead / no tags / consent unknown) and adds
 * `phoneE164` (and `whatsappE164` when a WhatsApp number is given). `phone` keeps the
 * trimmed raw value for display. Unknown keys are stripped.
 */
export const customerInputSchema = z
  .object({
    ...fields,
    customerType: fields.customerType.default("retail"),
    tags: fields.tags.default([]),
    segment: fields.segment.default("new_lead"),
    consent: fields.consent.default({ status: "unknown" }),
  })
  .transform((v) => {
    const cleaned = dropUndefined(v);
    return {
      ...cleaned,
      phoneE164: normalizePhone(cleaned.phone) as string,
      ...(cleaned.whatsappNumber !== undefined
        ? { whatsappE164: normalizePhone(cleaned.whatsappNumber) as string }
        : {}),
    };
  });

/**
 * PATCH body. Same rules as the create schema but every field is optional and NO defaults
 * are applied, so patching `{ fullName }` yields exactly `{ fullName }` and never resets
 * consent, tags or segment. Derived phone fields are recomputed when the matching field is
 * present. An empty patch (after stripping unknown keys and blank optional strings) is rejected.
 */
export const customerPatchSchema = z
  .object(fields)
  .partial()
  .transform((v) => dropUndefined(v))
  .refine((v) => Object.keys(v).length > 0, { error: "At least one field is required" })
  .transform((v) => withDerivedPhones(v));

export type CustomerInput = z.output<typeof customerInputSchema>;
export type CustomerPatch = z.output<typeof customerPatchSchema>;

/** A persisted customer. `fullNameLower` is a service-computed sort key, not part of the schema. */
export type Customer = CustomerInput & {
  id: string;
  organizationId: string;
  /** Lifetime spend in minor currency units (e.g. poisha); integer >= 0. */
  totalSpendMinor: number;
  lastInteractionAt: string | null;
  createdAt: string;
  updatedAt: string;
};
