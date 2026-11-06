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
/** Longest raw phone string accepted before cleaning (the E.164 cap is far lower). */
const MAX_RAW_PHONE = 200;

// All messages are static: they never echo the submitted value (it may be PII).
const PHONE_MESSAGE = "Enter a valid mobile number";
const EMAIL_MESSAGE = "Enter a valid email address";
const NAME_MESSAGE = "Enter the customer's name";

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

/** True for strings that are empty or hold only whitespace / control / invisible format characters. */
const isBlank = (v: string) => /^[\s\p{Cc}\p{Cf}]*$/u.test(v);

/**
 * Display text for a phone number: control and invisible format characters (bidi marks,
 * zero-width, BOM) removed, internal whitespace collapsed to single spaces.
 *
 * This is DISPLAY TEXT ONLY. Lookups and de-duplication must use `phoneE164` /
 * `whatsappE164`, never the raw strings.
 */
function cleanDisplayText(v: string): string {
  return v
    .replace(/\s+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

const phoneCore = z
  .string({ error: PHONE_MESSAGE })
  .max(MAX_RAW_PHONE, { error: PHONE_MESSAGE })
  .transform(cleanDisplayText)
  .pipe(z.string().refine((v) => normalizePhone(v) !== null, { error: PHONE_MESSAGE }));

const emailCore = z
  .string({ error: EMAIL_MESSAGE })
  .max(254, { error: EMAIL_MESSAGE }) // before any pipe, so the email regex never sees huge input
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: EMAIL_MESSAGE }));

const addressCore = z.string().trim().max(500, "Use 500 characters or fewer");
const leadSourceCore = z.string().trim().max(80, "Use 80 characters or fewer");

/**
 * Invisible format characters (\p{Cf}) are stripped from names EXCEPT U+200C (ZWNJ) and U+200D
 * (ZWJ): they control conjunct and letter shaping in Bangla/Persian, so removing them would
 * corrupt real names. Keep both as escapes: written literally they are invisible, and a
 * formatter that strips them would silently turn this into "strip every format character".
 */
const STRIPPED_FROM_NAMES = /(?![\u200C\u200D])\p{Cf}/gu;

/**
 * Create flavour of a blank-able optional field: a blank string (after trimming) is omitted
 * from the output. `null` is rejected (it is only meaningful in PATCH).
 */
function omitWhenBlank(core: z.ZodType<string, string>, message: string) {
  return z
    .string({ error: message })
    .transform((v) => (isBlank(v) ? undefined : v))
    .pipe(core.optional())
    .optional();
}

/**
 * PATCH flavour of a clearable optional field: `null` or a blank string means "clear this
 * field". The output carries an explicit `null`; the service layer (Task 15) maps `null` to
 * `FieldValue.delete()` instead of writing it.
 */
function clearable(core: z.ZodType<string, string>) {
  return z
    .preprocess((v) => (v === null || (typeof v === "string" && isBlank(v)) ? null : v), core.nullable())
    .optional();
}

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

/** Rules shared verbatim by create and PATCH. None of them carries a default. */
const sharedFields = {
  fullName: z
    .string({ error: NAME_MESSAGE })
    .max(1000, "Use 120 characters or fewer")
    .transform((v) => v.normalize("NFC").replace(STRIPPED_FROM_NAMES, "").trim())
    .pipe(
      z
        .string()
        .min(1, NAME_MESSAGE)
        .max(120, "Use 120 characters or fewer")
        // A name made only of ZWJ/ZWNJ is as blank as an empty one.
        .refine((v) => !isBlank(v), { error: NAME_MESSAGE }),
    ),
  phone: phoneCore,
  customerType: z.enum(CUSTOMER_TYPES, { error: "Choose a customer type" }),
  tags: z
    .array(z.string().trim().min(1, "Tags cannot be empty").max(40, "Use 40 characters or fewer per tag"), {
      error: "Tags must be a list",
    })
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
 * Adds the derived E.164 fields. They are computed only here, never read from client input
 * (the object schemas strip unknown keys, including `phoneE164` / `whatsappE164`). A `null`
 * whatsappNumber (PATCH "clear") yields `whatsappE164: null` so it cannot go stale.
 */
function withDerivedPhones<T extends { phone: string; whatsappNumber?: string }>(
  value: T,
): T & { phoneE164: string; whatsappE164?: string };
function withDerivedPhones<T extends { phone?: string; whatsappNumber?: string | null }>(
  value: T,
): T & { phoneE164?: string; whatsappE164?: string | null };
function withDerivedPhones(value: { phone?: string; whatsappNumber?: string | null }): Record<string, unknown> {
  const out: Record<string, unknown> = { ...value };
  if (value.phone !== undefined) out.phoneE164 = normalizePhone(value.phone) ?? undefined;
  if (value.whatsappNumber === null) out.whatsappE164 = null;
  else if (value.whatsappNumber !== undefined) out.whatsappE164 = normalizePhone(value.whatsappNumber) ?? undefined;
  return dropUndefined(out);
}

/**
 * Create body. Applies defaults (retail / new_lead / no tags / consent unknown) and adds
 * `phoneE164` (and `whatsappE164` when a WhatsApp number is given). `phone` /
 * `whatsappNumber` keep a cleaned display copy of the raw value (control and format
 * characters removed, whitespace collapsed). Blank email/whatsappNumber are omitted and
 * `null` is rejected. Unknown keys are stripped.
 */
export const customerInputSchema = z
  .object({
    fullName: sharedFields.fullName,
    phone: sharedFields.phone,
    whatsappNumber: omitWhenBlank(phoneCore, PHONE_MESSAGE),
    email: omitWhenBlank(emailCore, EMAIL_MESSAGE),
    address: addressCore.optional(),
    customerType: sharedFields.customerType.default("retail"),
    leadSource: leadSourceCore.optional(),
    tags: sharedFields.tags.default([]),
    segment: sharedFields.segment.default("new_lead"),
    preferences: sharedFields.preferences,
    assignedAgentId: sharedFields.assignedAgentId,
    consent: sharedFields.consent.default({ status: "unknown" }),
  })
  .transform((v) => withDerivedPhones(dropUndefined(v)));

/**
 * PATCH body. Same rules as the create schema but every field is optional and NO defaults
 * are applied, so patching `{ fullName }` yields exactly `{ fullName }` and never resets
 * consent, tags or segment. Derived phone fields are recomputed when the matching field is
 * present. `email`, `whatsappNumber`, `address` and `leadSource` are clearable: `null` or a
 * blank string parses to `null` (and `{ whatsappNumber: null }` also yields
 * `whatsappE164: null`). The Task 15 service maps those `null`s to `FieldValue.delete()`.
 * An empty patch (after stripping unknown keys) is rejected.
 */
export const customerPatchSchema = z
  .object({
    fullName: sharedFields.fullName,
    phone: sharedFields.phone,
    whatsappNumber: clearable(phoneCore),
    email: clearable(emailCore),
    address: clearable(addressCore),
    customerType: sharedFields.customerType,
    leadSource: clearable(leadSourceCore),
    tags: sharedFields.tags,
    segment: sharedFields.segment,
    preferences: sharedFields.preferences,
    assignedAgentId: sharedFields.assignedAgentId,
    consent: sharedFields.consent,
  })
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
