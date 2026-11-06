/**
 * Pure logic behind the customer form: form defaults, turning form values into an API body,
 * diffing an edit into a minimal PATCH, mapping API errors onto fields, and the tag chip helper.
 * No React, so it is unit tested directly.
 */
import type { z } from "zod";

import type { CustomerCreateBody, CustomerPatchBody } from "@/hooks/use-customers";
import type { ApiError } from "@/lib/api/client";
import type { Customer, customerInputSchema } from "@/schemas/customer";

/** The form edits the schema's INPUT shape (defaults not yet applied). */
export type CustomerFormValues = z.input<typeof customerInputSchema>;

export const MAX_TAGS = 20;

export const EMPTY_FORM_VALUES: CustomerFormValues = {
  fullName: "",
  phone: "",
  whatsappNumber: "",
  email: "",
  address: "",
  customerType: "retail",
  leadSource: "",
  tags: [],
  segment: "new_lead",
  preferences: { language: undefined, notes: "" },
  consent: { status: "unknown", source: "" },
};

export function customerToFormValues(c: Customer): CustomerFormValues {
  return {
    fullName: c.fullName,
    phone: c.phone,
    whatsappNumber: c.whatsappNumber ?? "",
    email: c.email ?? "",
    address: c.address ?? "",
    customerType: c.customerType,
    leadSource: c.leadSource ?? "",
    tags: [...c.tags],
    segment: c.segment,
    preferences: { language: c.preferences?.language, notes: c.preferences?.notes ?? "" },
    // `at` is owned by the server (kept when the status is unchanged), so it is not edited here.
    consent: { status: c.consent.status, source: c.consent.source ?? "" },
  };
}

const text = (v: string | undefined): string | undefined => {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : undefined;
};

function dedupeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Trims text, drops blank optional fields, de-duplicates tags. The result is what the API receives. */
export function prepareCustomerBody(values: CustomerFormValues): CustomerCreateBody {
  const language = values.preferences?.language;
  const notes = text(values.preferences?.notes);
  const status = values.consent?.status ?? "unknown";
  const source = status === "granted" ? text(values.consent?.source) : undefined;

  const body: CustomerCreateBody = {
    fullName: (values.fullName ?? "").trim(),
    phone: (values.phone ?? "").trim(),
    customerType: values.customerType,
    segment: values.segment,
    tags: dedupeTags(values.tags ?? []),
    consent: source === undefined ? { status } : { status, source },
  };
  const whatsappNumber = text(values.whatsappNumber);
  const email = text(values.email);
  const address = text(values.address);
  const leadSource = text(values.leadSource);
  if (whatsappNumber) body.whatsappNumber = whatsappNumber;
  if (email) body.email = email;
  if (address) body.address = address;
  if (leadSource) body.leadSource = leadSource;
  if (language || notes) body.preferences = { ...(language ? { language } : {}), ...(notes ? { notes } : {}) };
  return body;
}

const PATCH_KEYS = [
  "fullName",
  "phone",
  "whatsappNumber",
  "email",
  "address",
  "customerType",
  "leadSource",
  "tags",
  "segment",
  "preferences",
  "consent",
] as const;
const CLEARABLE = new Set<string>(["whatsappNumber", "email", "address", "leadSource"]);

/**
 * The minimal PATCH body for an edit: only changed fields; cleared clearable fields become `null`;
 * cleared preferences become `{}` (PATCH replaces the whole map). `consent` is sent whole when it
 * changed. Both arguments must come from `prepareCustomerBody`.
 */
export function buildPatch(initial: CustomerCreateBody, next: CustomerCreateBody): CustomerPatchBody {
  const patch: Record<string, unknown> = {};
  for (const key of PATCH_KEYS) {
    const before = initial[key];
    const after = next[key];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (after === undefined) {
      if (CLEARABLE.has(key)) patch[key] = null;
      else if (key === "preferences") patch[key] = {};
      continue;
    }
    patch[key] = after;
  }
  return patch as CustomerPatchBody;
}

export type FormFieldName =
  | "fullName"
  | "phone"
  | "whatsappNumber"
  | "email"
  | "address"
  | "customerType"
  | "leadSource"
  | "tags"
  | "segment"
  | "preferences.language"
  | "preferences.notes"
  | "consent.status"
  | "consent.source";

const FIELD_NAMES: ReadonlySet<string> = new Set<FormFieldName>([
  "fullName",
  "phone",
  "whatsappNumber",
  "email",
  "address",
  "customerType",
  "leadSource",
  "tags",
  "segment",
  "preferences.language",
  "preferences.notes",
  "consent.status",
  "consent.source",
]);

function toFieldName(path: string): FormFieldName | null {
  const normalized = path.replace(/\.\d+(?=\.|$)/g, ""); // "tags.2" -> "tags"
  return FIELD_NAMES.has(normalized) ? (normalized as FormFieldName) : null;
}

export interface MappedApiError {
  fields: { name: FormFieldName; message: string }[];
  formError: string | null;
  requestId?: string;
}

export const DUPLICATE_PHONE_MESSAGE = "A customer with this phone number already exists";

/** Turns a failed save into per-field errors plus (at most) one top-level message. */
export function mapApiError(error: ApiError): MappedApiError {
  const requestId = error.requestId;
  if (error.code === "CONFLICT") {
    return {
      fields: [{ name: "phone", message: DUPLICATE_PHONE_MESSAGE }],
      formError: null,
      requestId,
    };
  }
  if (error.code === "UNAUTHENTICATED") {
    return { fields: [], formError: "Your session has expired. Please sign in again.", requestId };
  }
  if (error.code === "FORBIDDEN") {
    return { fields: [], formError: "You do not have permission to make this change.", requestId };
  }
  if (error.code === "VALIDATION_ERROR" && error.details.length > 0) {
    const fields: MappedApiError["fields"] = [];
    const unmatched: string[] = [];
    for (const detail of error.details) {
      const name = toFieldName(detail.path);
      if (name) fields.push({ name, message: detail.message });
      else unmatched.push(detail.message);
    }
    return { fields, formError: unmatched.length > 0 ? unmatched.join(" ") : null, requestId };
  }
  return { fields: [], formError: error.message, requestId };
}

/** Adds comma-separated tags to a list: trimmed, blanks and case-insensitive duplicates ignored, capped. */
export function addTags(current: readonly string[], raw: string): string[] {
  const out = [...current];
  const seen = new Set(out.map((t) => t.toLowerCase()));
  for (const piece of raw.split(",")) {
    const tag = piece.trim();
    if (!tag || seen.has(tag.toLowerCase()) || out.length >= MAX_TAGS) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}
