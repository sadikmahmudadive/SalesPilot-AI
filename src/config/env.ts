/**
 * Validated SERVER environment access. Server-only: importing this from client code
 * fails the build. Public variables live in env.client.ts.
 *
 * `process.env` is read only in this file and env.client.ts.
 * Validation errors list variable NAMES only, never values.
 */
import "server-only";
import { z } from "zod";

import { blankToUndefined, failWithNames, type RawEnv } from "./env.shared";

const required = z.string().min(1);
const optional = z.string().min(1).optional();

const serverShape = {
  FIREBASE_PROJECT_ID: required,
  FIREBASE_CLIENT_EMAIL: optional,
  FIREBASE_PRIVATE_KEY: z
    .string()
    .min(1)
    .transform((key) => key.replace(/\\n/g, "\n"))
    .optional(),
  FIRESTORE_EMULATOR_HOST: optional,
  FIREBASE_AUTH_EMULATOR_HOST: optional,
  SESSION_COOKIE_MAX_DAYS: z.preprocess(
    (value) => (value === undefined ? 5 : Number(value)),
    z.number().int().min(1).max(14),
  ),

  CLOUDINARY_CLOUD_NAME: optional,
  CLOUDINARY_API_KEY: optional,
  CLOUDINARY_API_SECRET: optional,

  WHATSAPP_PHONE_NUMBER_ID: optional,
  WHATSAPP_BUSINESS_ACCOUNT_ID: optional,
  WHATSAPP_ACCESS_TOKEN: optional,
  WHATSAPP_VERIFY_TOKEN: optional,
  WHATSAPP_APP_SECRET: optional,
  META_GRAPH_API_VERSION: optional,

  OPENAI_API_KEY: optional,
  OPENAI_CHAT_MODEL: optional,
  OPENAI_REALTIME_MODEL: optional,

  TWILIO_ACCOUNT_SID: optional,
  TWILIO_AUTH_TOKEN: optional,
  TWILIO_PHONE_NUMBER: optional,
  TWILIO_WEBHOOK_SECRET: optional,

  SSLCOMMERZ_STORE_ID: optional,
  SSLCOMMERZ_STORE_PASSWORD: optional,
  SSLCOMMERZ_IS_LIVE: optional,

  N8N_WEBHOOK_URL: optional,
  N8N_WEBHOOK_SECRET: optional,

  ENCRYPTION_KEY: optional,
  CRON_SECRET: optional,
};

const serverSchema = z.object(serverShape).superRefine((env, ctx) => {
  const emulator = Boolean(env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST);
  if (emulator) return;
  for (const name of ["FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"] as const) {
    if (!env[name]) {
      ctx.addIssue({ code: "custom", path: [name], message: "required outside the emulator" });
    }
  }
});

export type ServerEnv = z.infer<typeof serverSchema>;

export type Integration = "cloudinary" | "whatsapp" | "openai" | "twilio" | "sslcommerz" | "n8n";

const INTEGRATION_KEYS: Record<Integration, readonly (keyof ServerEnv)[]> = {
  cloudinary: ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"],
  whatsapp: [
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_APP_SECRET",
  ],
  openai: ["OPENAI_API_KEY"],
  twilio: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"],
  sslcommerz: ["SSLCOMMERZ_STORE_ID", "SSLCOMMERZ_STORE_PASSWORD"],
  n8n: ["N8N_WEBHOOK_URL", "N8N_WEBHOOK_SECRET"],
};

let serverCache: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (serverCache) return serverCache;
  const raw: RawEnv = {};
  for (const key of Object.keys(serverShape)) raw[key] = process.env[key];
  const result = serverSchema.safeParse(blankToUndefined(raw));
  if (!result.success) failWithNames("server", result.error);
  serverCache = result.data;
  return serverCache;
}

/** True when running against the Firebase emulators (Firestore or Auth host is set). */
export function isEmulator(): boolean {
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
}

/** True only when ALL variables of the integration are present and non-empty. */
export function isConfigured(integration: Integration): boolean {
  const env = getServerEnv();
  return INTEGRATION_KEYS[integration].every((key) => Boolean(env[key]));
}

/** Clears the memoized result. Test use only. */
export function __resetEnvCacheForTests(): void {
  serverCache = undefined;
}
