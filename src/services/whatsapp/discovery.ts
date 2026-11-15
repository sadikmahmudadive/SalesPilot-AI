/**
 * Finds the WhatsApp numbers an access token can connect, so a workspace only has to paste the
 * token and pick a number. Server-only.
 *
 * Meta's `debug_token` names the business accounts the token was granted for
 * (`granular_scopes[].target_ids`); each account's `phone_numbers` edge lists its numbers. Nothing
 * is stored here and the token is never returned or logged: connecting a number still goes through
 * `saveWhatsAppConnection`, which verifies it again.
 */
import "server-only";

import { getServerEnv } from "@/config/env";
import { ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";

import { graphApiVersion } from "./connections";

export const TOKEN_REJECTED_MESSAGE =
  "Meta did not accept this access token. Create a new permanent token and try again.";
export const WRONG_APP_MESSAGE =
  "This access token was created in a different Meta app. Create it in the Meta app this platform uses.";
export const META_UNREACHABLE_MESSAGE = "Couldn't reach Meta. Try again in a moment.";

const TIMEOUT_MS = 10_000;
const MAX_ACCOUNTS = 10;
const MAX_NUMBERS = 50;
const WHATSAPP_SCOPES = new Set(["whatsapp_business_management", "whatsapp_business_messaging"]);
const META_ID = /^\d{5,30}$/;

export interface DiscoveredNumber {
  phoneNumberId: string;
  businessAccountId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}

export interface DiscoveryResult {
  /** Empty when Meta names no business account for the token (connect with the IDs instead). */
  numbers: DiscoveredNumber[];
}

const reject = (message: string) =>
  new ValidationError([{ path: "accessToken", message }], message);

const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 120) : null);

export async function discoverWhatsAppNumbers(
  accessToken: string,
  deps: { fetchFn?: typeof fetch } = {},
): Promise<DiscoveryResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const env = getServerEnv();
  const base = `https://graph.facebook.com/${graphApiVersion()}`;
  const get = (path: string, bearer: string) =>
    fetchFn(`${base}${path}`, {
      headers: { Authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  // Inspect as the platform app when it is configured (Meta then also tells us whose token it is).
  const platformApp =
    env.WHATSAPP_APP_ID && env.WHATSAPP_APP_SECRET
      ? `${env.WHATSAPP_APP_ID}|${env.WHATSAPP_APP_SECRET}`
      : null;

  let info: Record<string, unknown>;
  try {
    const res = await get(
      `/debug_token?input_token=${encodeURIComponent(accessToken)}`,
      platformApp ?? accessToken,
    );
    const body = res.ok ? ((await res.json()) as { data?: unknown }) : null;
    info =
      body && typeof body.data === "object" && body.data !== null
        ? (body.data as Record<string, unknown>)
        : {};
    if (!res.ok) logger.warn("whatsapp.discovery.inspect_failed", { status: res.status });
  } catch {
    throw reject(META_UNREACHABLE_MESSAGE);
  }
  if (info.is_valid !== true) throw reject(TOKEN_REJECTED_MESSAGE);
  if (
    env.WHATSAPP_APP_ID &&
    typeof info.app_id === "string" &&
    info.app_id !== env.WHATSAPP_APP_ID
  ) {
    throw reject(WRONG_APP_MESSAGE);
  }

  const accounts = new Set<string>();
  const scopes = Array.isArray(info.granular_scopes) ? info.granular_scopes : [];
  for (const entry of scopes as Array<{ scope?: unknown; target_ids?: unknown }>) {
    if (typeof entry?.scope !== "string" || !WHATSAPP_SCOPES.has(entry.scope)) continue;
    if (!Array.isArray(entry.target_ids)) continue;
    for (const id of entry.target_ids) {
      if (typeof id === "string" && META_ID.test(id)) accounts.add(id);
    }
  }

  const numbers: DiscoveredNumber[] = [];
  for (const businessAccountId of [...accounts].slice(0, MAX_ACCOUNTS)) {
    try {
      const res = await get(
        `/${businessAccountId}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`,
        accessToken,
      );
      if (!res.ok) continue;
      const list = (await res.json()) as { data?: unknown };
      for (const n of Array.isArray(list.data)
        ? (list.data as Array<Record<string, unknown>>)
        : []) {
        if (typeof n?.id !== "string" || !META_ID.test(n.id)) continue;
        numbers.push({
          phoneNumberId: n.id,
          businessAccountId,
          displayPhoneNumber: text(n.display_phone_number),
          verifiedName: text(n.verified_name),
        });
      }
    } catch {
      // One unreachable account does not hide the others.
    }
  }
  return { numbers: numbers.slice(0, MAX_NUMBERS) };
}
