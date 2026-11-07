/**
 * Opaque pagination cursors. Pure and dependency-light so it can be unit tested without
 * Firestore.
 *
 * A cursor records the sort value and document id of the LAST item of a page, so the next
 * page can resume with `startAfter(sortValue, id)`. The token is base64url of compact JSON:
 * `{ t, v, id }` where `t` is the sort value's type tag:
 *   ts   -> `v` is an ISO-8601 UTC string (the repository turns it back into a Timestamp)
 *   s    -> string
 *   n    -> finite number
 *   b    -> boolean
 *   null -> `v` is null
 *
 * SECURITY: a cursor is NOT trusted and NOT signed. A forged or tampered cursor can only move
 * the start position within the caller's own org-scoped query: the repository always applies
 * `where organizationId == orgId` itself and never reads the org (or any filter) from a
 * cursor. The decoder therefore only needs to guarantee well-formed, bounded, typed data.
 *
 * Limitation: the id is carried in full, so ids close to the 1024-char token cap cannot be
 * paginated. Real ids (auto ids, uuids) are a few dozen characters.
 */
import { ValidationError } from "./errors";
import { isValidIdSegment } from "./ids";

export const MAX_CURSOR_LENGTH = 1024;

export type Cursor =
  | { t: "ts"; v: string; id: string }
  | { t: "s"; v: string; id: string }
  | { t: "n"; v: number; id: string }
  | { t: "b"; v: boolean; id: string }
  | { t: "null"; v: null; id: string };

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function invalid(message: string): ValidationError {
  // Never echo the token or any decoded value.
  return new ValidationError([{ path: "cursor", message }], "Invalid cursor");
}

export function encodeCursor(cursor: Cursor): string {
  const token = Buffer.from(
    JSON.stringify({ t: cursor.t, v: cursor.v, id: cursor.id }),
    "utf8",
  ).toString("base64url");
  // Oversize here is a data/config fault (a stored key too large), not a caller error:
  // plain Error with a generic message, never a ValidationError.
  if (token.length > MAX_CURSOR_LENGTH) throw new Error("Cursor too large to encode");
  return token;
}

export function decodeCursor(token: unknown): Cursor {
  if (typeof token !== "string") throw invalid("Cursor must be a string");
  if (token.length === 0 || token.length > MAX_CURSOR_LENGTH)
    throw invalid("Cursor has an invalid length");
  // Buffer's base64url decoder silently skips illegal characters, so check the alphabet.
  if (!BASE64URL.test(token)) throw invalid("Cursor is malformed");

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    throw invalid("Cursor is malformed");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw invalid("Cursor is malformed");

  const keys = Object.keys(parsed);
  if (keys.length !== 3 || !keys.includes("t") || !keys.includes("v") || !keys.includes("id")) {
    throw invalid("Cursor is malformed");
  }
  const { t, v, id } = parsed as { t: unknown; v: unknown; id: unknown };
  if (!isValidIdSegment(id)) throw invalid("Cursor is malformed");

  switch (t) {
    case "ts":
    case "s":
      if (typeof v !== "string") throw invalid("Cursor is malformed");
      return { t, v, id };
    case "n":
      if (typeof v !== "number" || !Number.isFinite(v)) throw invalid("Cursor is malformed");
      return { t, v, id };
    case "b":
      if (typeof v !== "boolean") throw invalid("Cursor is malformed");
      return { t, v, id };
    case "null":
      if (v !== null) throw invalid("Cursor is malformed");
      return { t, v: null, id };
    default:
      throw invalid("Cursor is malformed");
  }
}
