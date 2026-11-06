/**
 * Shared mapping of a failed save onto form fields. Pure: no React.
 *
 * Each form supplies how an API field path becomes one of its field names (`toField`, `null` when
 * the path is not a field on the form) and what a 409 means for it (`onConflict`). The rest
 * (session expiry, permission, validation details, everything else) is common.
 */
import { ApiError } from "@/lib/api/client";

export interface MappedApiError<Name extends string = string> {
  fields: { name: Name; message: string }[];
  formError: string | null;
  requestId?: string;
}

interface MapOptions<Name extends string> {
  toField: (path: string) => Name | null;
  /** The result for a 409 CONFLICT. */
  onConflict: (error: ApiError) => Omit<MappedApiError<Name>, "requestId">;
}

/** Turns a failed save into per-field errors plus (at most) one top-level message. */
export function mapApiErrorWith<Name extends string>(
  error: ApiError,
  { toField, onConflict }: MapOptions<Name>,
): MappedApiError<Name> {
  const requestId = error.requestId;
  if (error.code === "CONFLICT") return { ...onConflict(error), requestId };
  if (error.code === "UNAUTHENTICATED") {
    return { fields: [], formError: "Your session has expired. Please sign in again.", requestId };
  }
  if (error.code === "FORBIDDEN") {
    return { fields: [], formError: "You do not have permission to make this change.", requestId };
  }
  if (error.code === "VALIDATION_ERROR" && error.details.length > 0) {
    const fields: MappedApiError<Name>["fields"] = [];
    const unmatched: string[] = [];
    for (const detail of error.details) {
      const name = toField(detail.path);
      if (name) fields.push({ name, message: detail.message });
      else unmatched.push(detail.message);
    }
    return { fields, formError: unmatched.length > 0 ? unmatched.join(" ") : null, requestId };
  }
  return { fields: [], formError: error.message, requestId };
}

/** Anything thrown that is not an `ApiError` (a bug, not a server answer) becomes a generic one. */
export function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError({ status: 0, code: "UNKNOWN", message: "Something went wrong. Please try again." });
}
