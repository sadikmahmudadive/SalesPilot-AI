import { fetchOutboundJson } from "@/lib/api/outbound-http";
import { ValidationError } from "@/lib/errors";
import { unsealSecret } from "@/lib/security/secret-box";
import type { GatewayAccount } from "@/schemas/integration";

import type {
  CallbackRequest,
  CreateSessionInput,
  CreateSessionOutput,
  ParsedCallback,
  PaymentGateway,
  VerifyPaymentInput,
  VerifyPaymentOutput,
} from "./types";

interface UddoktaPayCredentials {
  apiKey: string;
}

function getCredentials(account: GatewayAccount): UddoktaPayCredentials {
  const json = unsealSecret(account.credentials);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "";

  if (!apiKey) {
    throw new ValidationError(undefined, "UddoktaPay requires apiKey credential");
  }

  return { apiKey };
}

export function validateUddoktaPayBaseUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("https://")) {
    throw new ValidationError(undefined, "UddoktaPay baseUrl must begin with https://");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError(undefined, "Invalid UddoktaPay baseUrl format");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
    hostname.startsWith("[")
  ) {
    throw new ValidationError(
      undefined,
      "UddoktaPay baseUrl must be a valid public hostname (no localhost or IP literals)",
    );
  }
  return parsed.origin;
}

export class UddoktaPayGateway implements PaymentGateway {
  readonly id = "uddoktapay" as const;

  async testConnection(account: GatewayAccount): Promise<void> {
    const creds = getCredentials(account);
    const baseUrl = validateUddoktaPayBaseUrl(account.publicConfig.baseUrl);

    // Call verify endpoint with dummy invoice to verify API key
    const res = await fetchOutboundJson<Record<string, unknown>>(`${baseUrl}/api/verify-payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "RT-UDDOKTAPAY-API-KEY": creds.apiKey,
      },
      body: JSON.stringify({ invoice_id: "test_ping" }),
    });

    if (String(res.message ?? "").toLowerCase().includes("invalid api key")) {
      throw new ValidationError(undefined, "UddoktaPay API key rejected");
    }
  }

  async createSession(
    account: GatewayAccount,
    input: CreateSessionInput,
  ): Promise<CreateSessionOutput> {
    const creds = getCredentials(account);
    const baseUrl = validateUddoktaPayBaseUrl(account.publicConfig.baseUrl);

    const amountDecimal = (input.amountMinor / 100).toFixed(2);

    const payload = {
      full_name: input.customer.name,
      email: input.customer.email ?? "customer@example.com",
      amount: amountDecimal,
      metadata: {
        tranId: input.tranId,
        orderNumber: input.orderNumber,
      },
      redirect_url: input.urls.success,
      cancel_url: input.urls.cancel,
      webhook_url: input.urls.ipn,
    };

    const res = await fetchOutboundJson<{
      status?: boolean;
      payment_url?: string;
      message?: string;
    }>(`${baseUrl}/api/checkout-v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "RT-UDDOKTAPAY-API-KEY": creds.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!res.status || !res.payment_url) {
      throw new ValidationError(
        undefined,
        `UddoktaPay session creation failed: ${res.message ?? "unknown error"}`,
      );
    }

    return {
      redirectUrl: res.payment_url,
      gatewayRef: input.tranId,
    };
  }

  async verify(
    account: GatewayAccount,
    ref: VerifyPaymentInput,
  ): Promise<VerifyPaymentOutput> {
    const creds = getCredentials(account);
    const baseUrl = validateUddoktaPayBaseUrl(account.publicConfig.baseUrl);

    const invoiceId = ref.gatewayRef ?? "";
    if (!invoiceId) {
      return {
        outcome: "failed",
        raw: { error: "Missing invoice_id for UddoktaPay verification" },
      };
    }

    const res = await fetchOutboundJson<{
      status?: string;
      amount?: string;
      invoice_id?: string;
      metadata?: { tranId?: string };
    }>(`${baseUrl}/api/verify-payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "RT-UDDOKTAPAY-API-KEY": creds.apiKey,
      },
      body: JSON.stringify({ invoice_id: invoiceId }),
    });

    const isCompleted = String(res.status ?? "").toUpperCase() === "COMPLETED";
    if (!isCompleted) {
      return {
        outcome: "failed",
        raw: res as Record<string, unknown>,
      };
    }

    const amountMinor = res.amount ? Math.round(parseFloat(res.amount) * 100) : undefined;
    const isTranMatch = !res.metadata?.tranId || res.metadata.tranId === ref.tranId;

    if (!isTranMatch) {
      return {
        outcome: "failed",
        amountMinor,
        currency: "BDT",
        gatewayTxnId: res.invoice_id,
        raw: res as Record<string, unknown>,
      };
    }

    return {
      outcome: "paid",
      amountMinor,
      currency: "BDT",
      gatewayTxnId: res.invoice_id,
      raw: res as Record<string, unknown>,
    };
  }

  parseCallback(req: CallbackRequest): ParsedCallback {
    const q = req.query;
    const b = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<
      string,
      unknown
    >;

    const invoiceId =
      typeof q.invoice_id === "string"
        ? q.invoice_id
        : typeof b.invoice_id === "string"
          ? b.invoice_id
          : undefined;

    const metadataTran =
      typeof b.metadata === "object" &&
      b.metadata !== null &&
      "tranId" in b.metadata &&
      typeof (b.metadata as { tranId: unknown }).tranId === "string"
        ? (b.metadata as { tranId: string }).tranId
        : undefined;

    const tranId =
      typeof q.tranId === "string"
        ? q.tranId
        : typeof b.tranId === "string"
          ? b.tranId
          : metadataTran;

    return {
      tranId,
      gatewayRef: invoiceId,
    };
  }
}

export const uddoktaPayGateway = new UddoktaPayGateway();
