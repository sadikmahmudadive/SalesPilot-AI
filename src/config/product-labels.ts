import { AVAILABILITIES, type Availability } from "@/schemas/product";

/** Badge variants understood by `components/ui/badge`. */
type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

/** Human labels and badge styles for product availability: the single source for tables, forms and filters. */
export const AVAILABILITY_LABELS: Readonly<Record<Availability, string>> = {
  active: "Active",
  draft: "Draft",
  archived: "Archived",
};

export const AVAILABILITY_VARIANTS: Readonly<Record<Availability, BadgeVariant>> = {
  active: "default",
  draft: "secondary",
  archived: "outline",
};

/** `{ value, label }` lists for select controls. */
export const AVAILABILITY_OPTIONS = AVAILABILITIES.map((value) => ({
  value,
  label: AVAILABILITY_LABELS[value],
}));

/** Active and draft: what a product can be set to (archiving has its own confirmation). */
export const LIVE_AVAILABILITY_OPTIONS = AVAILABILITY_OPTIONS.filter((o) => o.value !== "archived");
