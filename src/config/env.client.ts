/**
 * Validated public (NEXT_PUBLIC_*) environment. Safe to import from client code.
 * Must not import `server-only` or touch any server variable.
 */
import { z } from "zod";

import { blankToUndefined, failWithNames } from "./env.shared";

const required = z.string().min(1);

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_FIREBASE_API_KEY: required,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: required,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: required,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: required,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: required,
  NEXT_PUBLIC_FIREBASE_APP_ID: required,
  NEXT_PUBLIC_USE_EMULATORS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // Only read when NEXT_PUBLIC_USE_EMULATORS=true; override when the Auth emulator is not on 9199.
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL: z
    .url({ protocol: /^https?$/ })
    .default("http://127.0.0.1:9199"),
});

export type ClientEnv = z.infer<typeof clientSchema>;

let clientCache: ClientEnv | undefined;

export function getClientEnv(): ClientEnv {
  if (clientCache) return clientCache;
  // Each NEXT_PUBLIC_* variable must be referenced literally so Next.js can inline it
  // into the client bundle; dynamic `process.env[key]` access is not replaced.
  const raw = blankToUndefined({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    NEXT_PUBLIC_USE_EMULATORS: process.env.NEXT_PUBLIC_USE_EMULATORS,
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL: process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL,
  });
  const result = clientSchema.safeParse(raw);
  if (!result.success) failWithNames("client", result.error);
  clientCache = result.data;
  return clientCache;
}

/** Clears the memoized result. Test use only. */
export function __resetClientEnvCacheForTests(): void {
  clientCache = undefined;
}
