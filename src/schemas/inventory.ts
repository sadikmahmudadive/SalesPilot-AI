/**
 * Inventory schemas and record types. Pure (shared by API routes, services and, later, the UI).
 *
 * `productId` / `variantId` are only length-bounded here; whether they name a real inventory
 * document of the caller's organization is the service's job (an unknown, malformed or foreign
 * id is the same 404). `organizationId` and the counters are never read from a client.
 *
 * Source hygiene: no literal non-ASCII characters in this file.
 */
import { z } from "zod";

import { MAX_ADJUST_DELTA, MAX_REASON_LENGTH, MIN_REASON_LENGTH } from "@/config/inventory";

const idField = z.string({ error: "Invalid id" }).min(1, "Invalid id").max(200, "Invalid id");

/** A nonzero whole number, |delta| <= MAX_ADJUST_DELTA. */
export const deltaSchema = z
  .number({ error: "Enter a whole number" })
  .int({ error: "Enter a whole number" })
  .min(-MAX_ADJUST_DELTA, { error: "Adjustment is too large" })
  .max(MAX_ADJUST_DELTA, { error: "Adjustment is too large" })
  .refine((n) => n !== 0, { error: "Adjustment cannot be zero" });

/** Trimmed, MIN_REASON_LENGTH..MAX_REASON_LENGTH characters. */
export const reasonSchema = z
  .string({ error: "Enter a reason" })
  .max(1000, "Use 200 characters or fewer")
  .transform((v) => v.trim())
  .pipe(
    z
      .string()
      .min(MIN_REASON_LENGTH, `Enter at least ${MIN_REASON_LENGTH} characters`)
      .max(MAX_REASON_LENGTH, `Use ${MAX_REASON_LENGTH} characters or fewer`),
  );

/** The fields of an adjustment that the service validates again (it is callable without the route). */
export const adjustFieldsSchema = z.object({ delta: deltaSchema, reason: reasonSchema });
export type AdjustFields = z.output<typeof adjustFieldsSchema>;

/** POST /api/inventory/adjust body. */
export const adjustInputSchema = z.object({
  productId: idField,
  variantId: idField,
  delta: deltaSchema,
  reason: reasonSchema,
});
export type AdjustInput = z.output<typeof adjustInputSchema>;

/** Inventory counters of one stock unit (a product variant, or the `default` unit). */
export interface InventoryRecord {
  /** `${productId}__${variantId}` */
  id: string;
  organizationId: string;
  productId: string;
  variantId: string;
  onHand: number;
  reserved: number;
  /** Always `onHand - reserved`. */
  available: number;
  createdAt: string;
  updatedAt: string;
}

/** A list row: the record plus display data resolved from the product. */
export interface InventoryListItem extends InventoryRecord {
  productName: string;
  /** null when the product could not be resolved. */
  sku: string | null;
  variantLabel: string;
}

export type ReservationStatus = "reserved" | "released" | "committed";
