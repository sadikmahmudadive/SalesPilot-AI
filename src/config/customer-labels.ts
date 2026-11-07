import {
  CUSTOMER_SEGMENTS,
  CUSTOMER_TYPES,
  type ConsentStatus,
  type CustomerSegment,
  type CustomerType,
} from "@/schemas/customer";

/** Badge variants understood by `components/ui/badge`. */
export type CustomerBadgeVariant = "default" | "secondary" | "outline" | "destructive";

/** Human labels and badge styles for customer enums: the single source for tables, forms and profiles. */
export const SEGMENT_LABELS: Readonly<Record<CustomerSegment, string>> = {
  new_lead: "New lead",
  interested: "Interested",
  qualified_lead: "Qualified lead",
  potential_buyer: "Potential buyer",
  converted: "Converted",
  repeat_customer: "Repeat customer",
  wholesale_customer: "Wholesale customer",
  inactive: "Inactive",
};

export const SEGMENT_VARIANTS: Readonly<Record<CustomerSegment, CustomerBadgeVariant>> = {
  new_lead: "outline",
  interested: "secondary",
  qualified_lead: "secondary",
  potential_buyer: "secondary",
  converted: "default",
  repeat_customer: "default",
  wholesale_customer: "default",
  inactive: "outline",
};

/** `{ value, label }` lists for select controls, in schema order. */
export const SEGMENT_OPTIONS = CUSTOMER_SEGMENTS.map((value) => ({
  value,
  label: SEGMENT_LABELS[value],
}));

export const TYPE_LABELS: Readonly<Record<CustomerType, string>> = {
  retail: "Retail",
  wholesale: "Wholesale",
};

export const TYPE_OPTIONS = CUSTOMER_TYPES.map((value) => ({ value, label: TYPE_LABELS[value] }));

export const CONSENT_LABELS: Readonly<Record<ConsentStatus, string>> = {
  granted: "Granted",
  denied: "Denied",
  unknown: "Not recorded",
};

export const CONSENT_VARIANTS: Readonly<Record<ConsentStatus, CustomerBadgeVariant>> = {
  granted: "default",
  denied: "destructive",
  unknown: "outline",
};

export const LANGUAGE_LABELS = {
  bn: "Bangla",
  en: "English",
  mixed: "Mixed",
} as const;
export type CustomerLanguage = keyof typeof LANGUAGE_LABELS;
