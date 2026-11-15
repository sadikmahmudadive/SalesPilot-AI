import { fetchOutbound, fetchOutboundJson } from "@/lib/api/outbound-http";
import { ValidationError } from "@/lib/errors";
import { unsealSecret } from "@/lib/security/secret-box";
import type { CourierAccount, CourierLocation } from "@/schemas/courier";

import { mapRedxStatus } from "../status-map";
import type {
  CourierAdapter,
  CourierStatusEvent,
  ParcelInput,
  ParcelResult,
} from "../types";

interface RedXCredentials {
  accessToken: string;
}

function getCredentials(account: CourierAccount): RedXCredentials {
  const json = unsealSecret(account.credentials);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const accessToken = typeof parsed.accessToken === "string" ? parsed.accessToken.trim() : "";

  if (!accessToken) {
    throw new ValidationError(
      undefined,
      "RedX courier requires accessToken credential",
    );
  }

  return { accessToken };
}

function getBaseUrl(account: CourierAccount): string {
  const custom = account.publicConfig?.baseUrl;
  if (typeof custom === "string" && custom.trim().length > 0) {
    return custom.trim().replace(/\/+$/, "");
  }
  return account.mode === "live"
    ? "https://openapi.redx.com.bd/v1.0.0-beta"
    : "https://sandbox.redx.com.bd/v1.0.0-beta";
}

export class RedXAdapter implements CourierAdapter {
  readonly id = "redx" as const;
  readonly requiresLocation = true;

  async testConnection(account: CourierAccount): Promise<void> {
    const creds = getCredentials(account);
    const host = getBaseUrl(account);

    const res = await fetchOutbound(`${host}/areas?limit=1`, {
      method: "GET",
      headers: {
        "API-ACCESS-TOKEN": `Bearer ${creds.accessToken}`,
      },
    });

    if (!res.ok) {
      throw new ValidationError(undefined, `RedX connection test failed (HTTP ${res.status})`);
    }
  }

  async listLocations(
    account: CourierAccount,
    level: "city" | "zone" | "area",
    _parentId?: string,
  ): Promise<CourierLocation[]> {
    void _parentId;
    void level;
    const creds = getCredentials(account);
    const host = getBaseUrl(account);

    const res = await fetchOutboundJson<{ areas?: Array<Record<string, unknown>> }>(
      `${host}/areas`,
      {
        method: "GET",
        headers: { "API-ACCESS-TOKEN": `Bearer ${creds.accessToken}` },
      },
    );

    const areas = Array.isArray(res.areas) ? res.areas : [];
    return areas.map((a) => {
      const id = String(a.id ?? "");
      const district = typeof a.district_name === "string" ? `${a.district_name} - ` : "";
      const name = `${district}${String(a.name ?? "")}`;
      return { id, name };
    });
  }

  async createParcel(account: CourierAccount, input: ParcelInput): Promise<ParcelResult> {
    const creds = getCredentials(account);
    const host = getBaseUrl(account);
    const pickupStoreId = account.publicConfig?.pickupStoreId;

    const body = {
      customer_name: input.recipientName,
      customer_phone: input.recipientPhone,
      delivery_area: input.areaName || "",
      delivery_area_id: input.areaId ? Number(input.areaId) : undefined,
      customer_address: input.recipientAddress,
      merchant_invoice_id: input.invoice,
      cash_collection_amount: Math.max(0, Math.round(input.codAmountMinor / 100)),
      parcel_weight: Math.round(input.weightKg * 1000), // grams
      instruction: input.note || "",
      value: Math.max(0, Math.round(input.codAmountMinor / 100)),
      pickup_store_id: pickupStoreId ? Number(pickupStoreId) : undefined,
    };

    const res = await fetchOutboundJson<Record<string, unknown>>(`${host}/parcel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "API-ACCESS-TOKEN": `Bearer ${creds.accessToken}`,
      },
      body: JSON.stringify(body),
    });

    const trackingId = typeof res.tracking_id === "string" ? res.tracking_id : undefined;
    if (!trackingId) {
      const msg = typeof res.message === "string" ? res.message : "Failed to create RedX parcel";
      throw new ValidationError(undefined, msg);
    }

    return {
      consignmentId: trackingId,
      trackingCode: trackingId,
      trackingUrl: `https://redx.com.bd/track-order/?trackingId=${encodeURIComponent(trackingId)}`,
      raw: res,
    };
  }

  async findParcelByInvoice(
    account: CourierAccount,
    invoice: string,
  ): Promise<{
    consignmentId: string;
    trackingCode?: string;
    trackingUrl?: string;
  } | null> {
    if (!invoice) return null;
    const creds = getCredentials(account);
    const host = getBaseUrl(account);

    try {
      const res = await fetchOutboundJson<{ parcel?: Record<string, unknown> }>(
        `${host}/parcel/info?merchant_invoice_id=${encodeURIComponent(invoice)}`,
        {
          method: "GET",
          headers: { "API-ACCESS-TOKEN": `Bearer ${creds.accessToken}` },
        },
      );

      const trackingId =
        typeof res.parcel?.tracking_id === "string" ? res.parcel.tracking_id : undefined;
      if (!trackingId) return null;

      return {
        consignmentId: trackingId,
        trackingCode: trackingId,
        trackingUrl: `https://redx.com.bd/track-order/?trackingId=${encodeURIComponent(trackingId)}`,
      };
    } catch {
      return null;
    }
  }

  async getStatus(
    account: CourierAccount,
    consignmentId: string,
  ): Promise<{
    status: ReturnType<typeof mapRedxStatus>;
    rawStatus: string;
    at?: Date;
  }> {
    const creds = getCredentials(account);
    const host = getBaseUrl(account);

    const res = await fetchOutboundJson<{ parcel?: Record<string, unknown> }>(
      `${host}/parcel/info/${encodeURIComponent(consignmentId)}`,
      {
        method: "GET",
        headers: { "API-ACCESS-TOKEN": `Bearer ${creds.accessToken}` },
      },
    );

    const rawStatus = typeof res.parcel?.status === "string" ? res.parcel.status : "unknown";
    const status = mapRedxStatus(rawStatus);

    return {
      status,
      rawStatus,
      at: new Date(),
    };
  }

  verifyWebhook(
    headers: Record<string, string | undefined>,
    _rawBody: string,
    secret?: string,
  ): boolean {
    void _rawBody;
    if (!secret) return true;

    const authHeader = headers.authorization || headers.Authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7).trim() === secret.trim();
    }

    const headerSecret = headers["x-redx-secret"] || headers["x-webhook-secret"];
    return headerSecret === secret;
  }

  parseWebhook(body: unknown): CourierStatusEvent[] {
    if (!body || typeof body !== "object") return [];

    const items = Array.isArray(body)
      ? (body as Record<string, unknown>[])
      : [body as Record<string, unknown>];
    const events: CourierStatusEvent[] = [];

    for (const b of items) {
      const trackingId =
        typeof b.tracking_id === "string"
          ? b.tracking_id
          : typeof b.trackingId === "string"
            ? b.trackingId
            : undefined;
      const invoice =
        typeof b.merchant_invoice_id === "string"
          ? b.merchant_invoice_id
          : typeof b.invoice === "string"
            ? b.invoice
            : undefined;
      const rawStatus = typeof b.status === "string" ? b.status : "unknown";
      const status = mapRedxStatus(rawStatus);
      const at = b.updated_at ? new Date(String(b.updated_at)) : new Date();

      events.push({
        consignmentId: trackingId,
        trackingCode: trackingId,
        invoice,
        rawStatus,
        status,
        at,
      });
    }

    return events;
  }
}

export const redxAdapter = new RedXAdapter();
