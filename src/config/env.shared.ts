/**
 * Pure helpers shared by env.ts (server) and env.client.ts (client).
 * Must not read the environment and must not import `server-only`.
 */
import type { z } from "zod";

export type RawEnv = Record<string, string | undefined>;

/** Treat empty strings (as left in a copied .env.example) the same as unset. */
export function blankToUndefined(raw: RawEnv): RawEnv {
  const out: RawEnv = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = value === undefined || value === "" ? undefined : value;
  }
  return out;
}

/** Throws an Error listing the invalid variable NAMES only, never their values. */
export function failWithNames(scope: string, error: z.ZodError): never {
  const names = new Set<string>();
  for (const issue of error.issues) {
    names.add(issue.path.length > 0 ? issue.path.join(".") : "(unknown)");
  }
  throw new Error(`Invalid ${scope} environment variables: ${[...names].join(", ")}`);
}
