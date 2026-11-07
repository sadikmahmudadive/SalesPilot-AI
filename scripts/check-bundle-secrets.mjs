#!/usr/bin/env node
/**
 * Fails when the client bundle (.next/static) contains server-only variable NAMES, the VALUES of
 * those variables (when they are set in the environment running this script), or PEM private key
 * markers. Run `npm run build` first. Output never includes a secret value: only the variable
 * name (or marker label) and the file.
 *
 * Usage: node scripts/check-bundle-secrets.mjs   (or: npm run check:bundle)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The single list of variables that must never reach a browser bundle. */
export const SERVER_ONLY_VARIABLES = [
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_CLIENT_EMAIL",
  "CLOUDINARY_API_SECRET",
  "CLOUDINARY_API_KEY",
  "OPENAI_API_KEY",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_APP_SECRET",
  "TWILIO_AUTH_TOKEN",
  "SSLCOMMERZ_STORE_PASSWORD",
  "WHATSAPP_VERIFY_TOKEN",
  "TWILIO_WEBHOOK_SECRET",
  "N8N_WEBHOOK_SECRET",
  "ENCRYPTION_KEY",
  "CRON_SECRET",
];

/** Text markers that identify private key material. */
export const PEM_MARKERS = [
  "-----BEGIN PRIVATE KEY-----",
  "-----BEGIN RSA PRIVATE KEY-----",
  "-----BEGIN EC PRIVATE KEY-----",
];

/** Values shorter than this are not searched for (too likely to match unrelated bundle text). */
export const MIN_VALUE_LENGTH = 8;

/**
 * The forms in which a value can appear in a bundle: as is; with real newlines written as the
 * two characters backslash and n (JSON or a JS string); and with literal backslash-n sequences
 * turned into real newlines (a .env file stores a PEM key in the escaped form, a bundle may
 * hold the real one).
 */
export function valueForms(value) {
  return [...new Set([value, value.replace(/\n/g, "\\n"), value.replace(/\\n/g, "\n")])];
}

/** Names of server-only variables that are set but too short to be searched for. Names only. */
export function skippedShortValues(env = {}) {
  return SERVER_ONLY_VARIABLES.filter((name) => {
    const value = env[name];
    return typeof value === "string" && value.length > 0 && value.length < MIN_VALUE_LENGTH;
  });
}

/**
 * Pure scan of one file's text.
 * @param {string} content file text
 * @param {Record<string, string | undefined>} env variables whose values should be searched for
 * @returns {{ kind: "name" | "value" | "pem", label: string }[]} findings; `label` is a variable
 *   name or marker, never a secret value
 */
export function scanContent(content, env = {}) {
  const findings = [];
  for (const name of SERVER_ONLY_VARIABLES) {
    if (content.includes(name)) findings.push({ kind: "name", label: name });
    const value = env[name];
    if (typeof value === "string" && value.length >= MIN_VALUE_LENGTH) {
      if (valueForms(value).some((form) => content.includes(form))) {
        findings.push({ kind: "value", label: name });
      }
    }
  }
  for (const marker of PEM_MARKERS) {
    if (content.includes(marker)) findings.push({ kind: "pem", label: marker });
  }
  return findings;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

function run() {
  const root = resolve(process.cwd());
  const staticDir = join(root, ".next", "static");
  if (!existsSync(staticDir)) {
    console.error("check:bundle: .next/static not found. Run npm run build first.");
    return 1;
  }

  for (const name of skippedShortValues(process.env)) {
    console.log(
      `check:bundle: skipped short value for ${name} (under ${MIN_VALUE_LENGTH} characters)`,
    );
  }

  const hits = [];
  let files = 0;
  for (const file of walk(staticDir)) {
    files += 1;
    const content = readFileSync(file, "utf8");
    for (const finding of scanContent(content, process.env)) {
      hits.push({ file: relative(root, file), ...finding });
    }
  }

  if (hits.length > 0) {
    console.error(`check:bundle: FAILED, ${hits.length} finding(s) in the client bundle:`);
    for (const hit of hits) console.error(`  [${hit.kind}] ${hit.label} in ${hit.file}`);
    return 1;
  }
  console.log(
    `check:bundle: OK, scanned ${files} file(s) in .next/static, no server-only names, values or PEM markers.`,
  );
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) process.exitCode = run();
