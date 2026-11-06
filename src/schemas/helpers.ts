/** Zod building blocks shared by the customer and product schemas. Pure. */
import { z } from "zod";

import { isBlank } from "@/lib/text";

/**
 * Create flavour of a blank-able optional field: a blank string (after trimming) is omitted
 * from the output. `null` is rejected (it is only meaningful in PATCH).
 */
export function omitWhenBlank(core: z.ZodType<string, string>, message: string) {
  return z
    .string({ error: message })
    .transform((v) => (isBlank(v) ? undefined : v))
    .pipe(core.optional())
    .optional();
}

/**
 * PATCH flavour of a clearable optional field: `null` or a blank string means "clear this
 * field". The output carries an explicit `null`; the service layer maps `null` to
 * `FieldValue.delete()` instead of writing it.
 */
export function clearable(core: z.ZodType<string, string>) {
  return z
    .preprocess(
      (v) => (v === null || (typeof v === "string" && isBlank(v)) ? null : v),
      core.nullable(),
    )
    .optional();
}

export function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
