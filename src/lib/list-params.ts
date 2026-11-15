/**
 * Query-string parsing scaffolding shared by list endpoints. Pure.
 */
import { z } from "zod";

import { ValidationError, type ValidationDetail } from "@/lib/errors";
import { invalid as fieldError } from "@/lib/validation-error";

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 50;
export const MAX_SEARCH_LENGTH = 64;

/** Static messages only (never echo caller input); the message is also the envelope summary. */
export function staticInvalid(path: string, message: string): ValidationError {
  return fieldError(path, message, message);
}

/** An empty value counts as absent. */
export const optionalParam = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

/** `limit` param: 1..3 digits, 1..max. */
export const limitParam = (max: number = MAX_LIMIT) =>
  optionalParam(
    z
      .string()
      .regex(/^\d{1,3}$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(max)),
  );

/**
 * The page size of a list request: `limit` when given, else `defaultLimit`. It must be an
 * integer from 1 to `maxLimit`, otherwise a ValidationError with a static message.
 */
export function resolveListLimit(
  limit: number | undefined,
  opts: { defaultLimit: number; maxLimit: number },
): number {
  const value = limit ?? opts.defaultLimit;
  if (!Number.isInteger(value) || value < 1 || value > opts.maxLimit) {
    throw staticInvalid("limit", `Limit must be an integer between 1 and ${opts.maxLimit}`);
  }
  return value;
}

export const cursorParam = () => optionalParam(z.string().max(1024));

/**
 * Parses the keys of `schema` from `params`. Unknown params are ignored; repeated params and
 * invalid values are a ValidationError carrying only param names and static messages.
 */
export function parseQueryParams<S extends z.ZodObject>(
  params: URLSearchParams,
  schema: S,
): z.output<S> {
  const raw: Record<string, string> = {};
  const details: ValidationDetail[] = [];
  for (const key of Object.keys(schema.shape)) {
    const values = params.getAll(key);
    if (values.length > 1) details.push({ path: key, message: "Provide only one value" });
    else if (values.length === 1) raw[key] = values[0]!;
  }
  if (details.length > 0) throw new ValidationError(details);

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => ({
        path: String(i.path[0] ?? "query"),
        message: "Invalid value",
      })),
    );
  }
  return parsed.data;
}
