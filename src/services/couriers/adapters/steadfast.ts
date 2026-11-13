import { fetchOutbound, fetchOutboundJson } from "@/lib/api/outbound-http";
import { ValidationError } from "@/lib/errors";
import { unsealSecret } from "@/lib/security/secret-box";
import type { CourierAccount } from "@/schemas/courier";

import { mapSteadfastStatus } from "../status-map";
import type {
  CourierAdapter,
  CourierStatusEvent,
  ParcelInput,
  ParcelResult,
} from "../types";

interface SteadfastCredentials {
  apiKey: string;
  secretKey: string;
}

function getCredentials(account: CourierAccount): SteadfastCredentials {
  const json = unsealSecret(account.credentials);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "";
  const secretKey = typeof parsed.secretKey === "string" ? parsed.secretKey.trim() : "";

  if (!apiKey || !secretKey) {
    throw new ValidationError(
      undefined,
      "Steadfast courier requires apiKey and secretKey credentials",
    );
  }

  return { apiKey, secretKey };
}

function getBaseUrl(account: CourierAccount): string {
  const custom = account.publicConfig?.baseUrl;
  if (typeof custom === "string" && custom.trim().length > 0) {
    return custom.trim().replace(/\/+$/, "");
  }
  return "https://portal.packzy.com/api/v1";
}

export class SteadfastAdapter implements CourierAdapter {
  readonly id = "steadfast" as const;
  readonly requiresLocation = false;

  async testConnection(account: CourierAccount): Promise<void> {
    const creds = getCredentials(account);
    const host = getBaseUrl(account);

    const res = await fetchOutbound(`${host}/get_balance`, {
      method: "GET",
      headers: {
        "Api-Key": creds.apiKey,
        "Secret-Key": creds.secretKey,
      },
    });

    if (!res.ok) {
      throw new ValidationError(
        undefined,
        `Steadfast authentication failed (HTTP ${res.status})`,
      );
    }

    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new ValidationError(undefined, "Invalid response from Steadfast API");
    }

    if (json.status !== 200 && json.status !== "200") {
      throw new ValidationError(
        undefined,
        typeof json.message === "string" ? json.message : "Steadfast balance check failed",
      );
    }
  }

  async createParcel(account: CourierAccount, input: ParcelInput): Promise<ParcelResult> {
    const creds = getCredentials(account);
    const host = getBaseUrl(account);

    const body = {
      invoice: input.invoice,
      recipient_name: input.recipientName,
      recipient_phone: input.recipientPhone,
      recipient_address: input.recipientAddress,
      cod_amount: Math.max(0, Math.round(input.codAmountMinor / 100)),
      note: input.note || "",
    };

    const res = await fetchOutboundJson<Record<string, unknown>>(`${host}/create_order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": creds.apiKey,
        "Secret-Key": creds.secretKey,
      },
      body: JSON.stringify(body),
    });

    const statusNum = Number(res.status);
    const consignment = res.consignment as Record<string, unknown> | undefined;

    if (statusNum !== 200 || !consignment) {
      const msg = typeof res.message === "string" ? res.message : "Failed to create Steadfast parcel";
      throw new ValidationError(undefined, msg);
    }

    const consignmentId = String(consignment.consignment_id ?? "");
    const trackingCode = typeof consignment.tracking_code === "string" ? consignment.tracking_code : undefined;
    const trackingUrl = trackingCode
      ? `https://portal.packzy.com/tracking/${encodeURIComponent(trackingCode)}`
      : undefined;

    return {
      consignmentId,
      trackingCode,
      trackingUrl,
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
      const res = await fetchOutboundJson<Record<string, unknown>>(
        `${host}/status_by_invoice/${encodeURIComponent(invoice)}`,
        {
          method: "GET",
          headers: {
            "Api-Key": creds.apiKey,
            "Secret-Key": creds.secretKey,
          },
        },
      );

      const status = Number(res.status);
      if (status !== 200) return null;

      const cid = res.consignment_id ?? res.id;
      if (!cid) return null;

      const consignmentId = String(cid);
      const trackingCode = typeof res.tracking_code === "string" ? res.tracking_code : undefined;
      const trackingUrl = trackingCode
        ? `https://portal.packzy.com/tracking/${encodeURIComponent(trackingCode)}`
        : undefined;

      return {
        consignmentId,
        trackingCode,
        trackingUrl,
      };
    } catch {
      return null;
    }
  }

  async getStatus(
    account: CourierAccount,
    consignmentId: string,
  ): Promise<{
    status: ReturnType<typeof mapSteadfastStatus>;
    rawStatus: string;
    at?: Date;
  }> {
    const creds = getCredentials(account);
    const host = getBaseUrl(account);

    const res = await fetchOutboundJson<Record<string, unknown>>(
      `${host}/status_by_cid/${encodeURIComponent(consignmentId)}`,
      {
        method: "GET",
        headers: {
          "Api-Key": creds.apiKey,
          "Secret-Key": creds.secretKey,
        },
      },
    );

    const rawStatus = typeof res.delivery_status === "string" ? res.delivery_status : "unknown";
    const status = mapSteadfastStatus(rawStatus);

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

    const headerSecret = headers["x-steadfast-secret"] || headers["x-webhook-secret"];
    return headerSecret === secret;
  }

  parseWebhook(body: unknown): CourierStatusEvent[] {
    if (!body || typeof body !== "object") return [];

    const items = Array.isArray(body) ? (body as Record<string, unknown>[]) : [body as Record<string, unknown>];
    const events: CourierStatusEvent[] = [];

    for (const b of items) {
      const consignmentId =
        b.consignment_id !== undefined ? String(b.consignment_id) : undefined;
      const trackingCode = typeof b.tracking_code === "string" ? b.tracking_code : undefined;
      const invoice = typeof b.invoice === "string" ? b.invoice : undefined;
      const rawStatus =
        typeof b.status === "string"
          ? b.status
          : typeof b.delivery_status === "string"
            ? b.delivery_status
            : "unknown";
      const status = mapSteadfastStatus(rawStatus);
      const at = b.updated_at ? new Date(String(b.updated_at)) : new Date();

      events.push({
        consignmentId,
        trackingCode,
        invoice,
        rawStatus,
        status,
        at,
      });
    }

    return events;
  }
}

export const steadfastAdapter = new SteadfastAdapter();
