import { createHmac } from "node:crypto";

import { fetchOutbound, fetchOutboundJson } from "@/lib/api/outbound-http";
import { ValidationError } from "@/lib/errors";
import { sealSecret, unsealSecret } from "@/lib/security/secret-box";
import type { CourierAccount, CourierLocation } from "@/schemas/courier";

import { mapPathaoStatus } from "../status-map";
import type {
  CourierAdapter,
  CourierStatusEvent,
  ParcelInput,
  ParcelResult,
} from "../types";

interface PathaoCredentials {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

interface CachedToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix timestamp ms
}

const tokenMutex = new Map<string, Promise<string>>();

function getCredentials(account: CourierAccount): PathaoCredentials {
  const json = unsealSecret(account.credentials);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const clientId = typeof parsed.clientId === "string" ? parsed.clientId.trim() : "";
  const clientSecret = typeof parsed.clientSecret === "string" ? parsed.clientSecret.trim() : "";
  const username = typeof parsed.username === "string" ? parsed.username.trim() : "";
  const password = typeof parsed.password === "string" ? parsed.password.trim() : "";

  if (!clientId || !clientSecret || !username || !password) {
    throw new ValidationError(
      undefined,
      "Pathao courier requires clientId, clientSecret, username, and password",
    );
  }

  return { clientId, clientSecret, username, password };
}

function getBaseUrl(account: CourierAccount): string {
  const custom = account.publicConfig?.baseUrl;
  if (typeof custom === "string" && custom.trim().length > 0) {
    return custom.trim().replace(/\/+$/, "");
  }
  return account.mode === "live"
    ? "https://api-hermes.pathao.com"
    : "https://courier-api-sandbox.pathao.com";
}

export async function getPathaoToken(account: CourierAccount): Promise<string> {
  const now = Date.now();
  const FIVE_MINUTES_MS = 5 * 60 * 1000;

  // 1. Check account.tokenCache
  if (account.tokenCache) {
    try {
      const tokenJson = unsealSecret(account.tokenCache);
      const cached = JSON.parse(tokenJson) as CachedToken;
      if (cached.accessToken && cached.expiresAt - now > FIVE_MINUTES_MS) {
        return cached.accessToken;
      }
    } catch {
      // Ignore cache decryption/parse failure and fetch fresh token
    }
  }

  // 2. Single-flight mutex per account to avoid storming Pathao auth
  const existingFlight = tokenMutex.get(account.id);
  if (existingFlight) return existingFlight;

  const fetchPromise = (async () => {
    try {
      const creds = getCredentials(account);
      const host = getBaseUrl(account);

      const res = await fetchOutboundJson<Record<string, unknown>>(
        `${host}/aladdin/api/v1/issue-token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            username: creds.username,
            password: creds.password,
            grant_type: "password",
          }),
        },
      );

      const accessToken = typeof res.access_token === "string" ? res.access_token : "";
      const refreshToken = typeof res.refresh_token === "string" ? res.refresh_token : undefined;
      const expiresInSec = typeof res.expires_in === "number" ? res.expires_in : 3600;

      if (!accessToken) {
        const msg = typeof res.message === "string" ? res.message : "Failed to obtain Pathao token";
        throw new ValidationError(undefined, msg);
      }

      const tokenData: CachedToken = {
        accessToken,
        refreshToken,
        expiresAt: now + expiresInSec * 1000,
      };

      account.tokenCache = sealSecret(JSON.stringify(tokenData));
      return accessToken;
    } finally {
      tokenMutex.delete(account.id);
    }
  })();

  tokenMutex.set(account.id, fetchPromise);
  return fetchPromise;
}

export class PathaoAdapter implements CourierAdapter {
  readonly id = "pathao" as const;
  readonly requiresLocation = true;

  async testConnection(account: CourierAccount): Promise<void> {
    const token = await getPathaoToken(account);
    const host = getBaseUrl(account);

    const res = await fetchOutbound(`${host}/aladdin/api/v1/countries/1/city-list`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      throw new ValidationError(undefined, `Pathao connection test failed (HTTP ${res.status})`);
    }
  }

  async listLocations(
    account: CourierAccount,
    level: "city" | "zone" | "area",
    parentId?: string,
  ): Promise<CourierLocation[]> {
    const token = await getPathaoToken(account);
    const host = getBaseUrl(account);

    let url: string;
    if (level === "city") {
      url = `${host}/aladdin/api/v1/countries/1/city-list`;
    } else if (level === "zone") {
      if (!parentId) throw new ValidationError(undefined, "Pathao requires cityId for zone lookup");
      url = `${host}/aladdin/api/v1/cities/${encodeURIComponent(parentId)}/zone-list`;
    } else {
      if (!parentId) throw new ValidationError(undefined, "Pathao requires zoneId for area lookup");
      url = `${host}/aladdin/api/v1/zones/${encodeURIComponent(parentId)}/area-list`;
    }

    const res = await fetchOutboundJson<Record<string, unknown>>(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    const dataObj = res.data as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
    const items = Array.isArray(dataObj)
      ? dataObj
      : Array.isArray((dataObj as Record<string, unknown>)?.data)
        ? ((dataObj as Record<string, unknown>).data as Array<Record<string, unknown>>)
        : [];

    return items.map((item) => {
      const id = String(item.city_id ?? item.zone_id ?? item.area_id ?? item.id ?? "");
      const name = String(item.city_name ?? item.zone_name ?? item.area_name ?? item.name ?? "");
      return { id, name };
    });
  }

  async createParcel(account: CourierAccount, input: ParcelInput): Promise<ParcelResult> {
    const token = await getPathaoToken(account);
    const host = getBaseUrl(account);

    const storeId = account.publicConfig?.storeId;
    if (!storeId) {
      throw new ValidationError(
        undefined,
        "Pathao requires a storeId configured in courier account settings",
      );
    }

    if (!input.cityId || !input.zoneId) {
      throw new ValidationError(
        undefined,
        "Pathao requires city and zone selections for parcel booking",
      );
    }

    const body = {
      store_id: Number(storeId),
      merchant_order_id: input.invoice,
      recipient_name: input.recipientName,
      recipient_phone: input.recipientPhone,
      recipient_address: input.recipientAddress,
      recipient_city: Number(input.cityId),
      recipient_zone: Number(input.zoneId),
      recipient_area: input.areaId ? Number(input.areaId) : undefined,
      delivery_type: 48,
      item_type: 2,
      special_instruction: input.note || "",
      item_quantity: 1,
      item_weight: input.weightKg,
      amount_to_collect: Math.max(0, Math.round(input.codAmountMinor / 100)),
      item_description: input.itemDescription || "Goods",
    };

    const res = await fetchOutboundJson<Record<string, unknown>>(`${host}/aladdin/api/v1/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const data = res.data as Record<string, unknown> | undefined;
    if (!data?.consignment_id) {
      const msg = typeof res.message === "string" ? res.message : "Failed to create Pathao order";
      throw new ValidationError(undefined, msg);
    }

    const consignmentId = String(data.consignment_id);
    const trackingCode = typeof data.merchant_order_id === "string" ? data.merchant_order_id : input.invoice;
    const deliveryFee = typeof data.delivery_fee === "number" ? Math.round(data.delivery_fee * 100) : undefined;

    return {
      consignmentId,
      trackingCode,
      trackingUrl: `https://pathao.com/track/?consignment_id=${encodeURIComponent(consignmentId)}`,
      chargeMinor: deliveryFee,
      raw: res,
    };
  }

  async getStatus(
    account: CourierAccount,
    consignmentId: string,
  ): Promise<{
    status: ReturnType<typeof mapPathaoStatus>;
    rawStatus: string;
    at?: Date;
  }> {
    const token = await getPathaoToken(account);
    const host = getBaseUrl(account);

    const res = await fetchOutboundJson<Record<string, unknown>>(
      `${host}/aladdin/api/v1/orders/${encodeURIComponent(consignmentId)}/info`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    const data = res.data as Record<string, unknown> | undefined;
    const rawStatus = typeof data?.order_status === "string" ? data.order_status : "unknown";
    const status = mapPathaoStatus(rawStatus);

    return {
      status,
      rawStatus,
      at: new Date(),
    };
  }

  webhookHandshake(req: Request): Response | null {
    const url = new URL(req.url);
    const challenge =
      url.searchParams.get("hub.challenge") ||
      req.headers.get("x-pathao-challenge") ||
      url.searchParams.get("challenge");

    if (challenge) {
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return null;
  }

  verifyWebhook(
    headers: Record<string, string | undefined>,
    rawBody: string,
    secret?: string,
  ): boolean {
    if (!secret) return true;

    const signature = headers["x-pathao-signature"] || headers["x-signature"];
    if (signature) {
      const hmac = createHmac("sha256", secret).update(rawBody).digest("hex");
      return hmac.toLowerCase() === signature.trim().toLowerCase();
    }

    const headerSecret = headers["x-webhook-secret"];
    return headerSecret === secret;
  }

  parseWebhook(body: unknown): CourierStatusEvent[] {
    if (!body || typeof body !== "object") return [];

    const b = body as Record<string, unknown>;
    const data = (b.data as Record<string, unknown>) || b;

    const consignmentId = data.consignment_id !== undefined ? String(data.consignment_id) : undefined;
    const trackingCode = typeof data.merchant_order_id === "string" ? data.merchant_order_id : undefined;
    const invoice = typeof data.merchant_order_id === "string" ? data.merchant_order_id : undefined;
    const rawStatus = typeof data.order_status === "string" ? data.order_status : "unknown";
    const status = mapPathaoStatus(rawStatus);
    const at = data.updated_at ? new Date(String(data.updated_at)) : new Date();

    return [
      {
        consignmentId,
        trackingCode,
        invoice,
        rawStatus,
        status,
        at,
      },
    ];
  }
}

export const pathaoAdapter = new PathaoAdapter();
