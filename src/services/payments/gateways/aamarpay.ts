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

interface AamarPayCredentials {
  storeId: string;
  signatureKey: string;
}

function getCredentials(account: GatewayAccount): AamarPayCredentials {
  const json = unsealSecret(account.credentials);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const storeId = typeof parsed.storeId === "string" ? parsed.storeId.trim() : "";
  const signatureKey = typeof parsed.signatureKey === "string" ? parsed.signatureKey.trim() : "";

  if (!storeId || !signatureKey) {
    throw new ValidationError(
      undefined,
      "aamarPay requires storeId and signatureKey credentials",
    );
  }

  return { storeId, signatureKey };
}

function getBaseUrl(mode: GatewayAccount["mode"]): string {
  return mode === "live"
    ? "https://secure.aamarpay.com"
    : "https://sandbox.aamarpay.com";
}

export class AamarPayGateway implements PaymentGateway {
  readonly id = "aamarpay" as const;

  async testConnection(account: GatewayAccount): Promise<void> {
    const creds = getCredentials(account);
    const host = getBaseUrl(account.mode);

    // Call check API with dummy request_id to verify store credentials
    const url = `${host}/api/v1/trxcheck/request.php?request_id=test_ping&store_id=${encodeURIComponent(
      creds.storeId,
    )}&signature_key=${encodeURIComponent(creds.signatureKey)}&type=json`;

    const res = await fetchOutboundJson<Record<string, unknown>>(url);
    if (res.status_code === 401 || String(res.error ?? "").toLowerCase().includes("invalid")) {
      throw new ValidationError(undefined, "aamarPay credentials rejected: Store ID or Signature Key invalid");
    }
  }

  async createSession(
    account: GatewayAccount,
    input: CreateSessionInput,
  ): Promise<CreateSessionOutput> {
    const creds = getCredentials(account);
    const host = getBaseUrl(account.mode);

    const amountDecimal = (input.amountMinor / 100).toFixed(2);

    const payload = {
      store_id: creds.storeId,
      signature_key: creds.signatureKey,
      tran_id: input.tranId,
      amount: amountDecimal,
      currency: "BDT",
      desc: input.orderNumber,
      cus_name: input.customer.name,
      cus_email: input.customer.email ?? "customer@example.com",
      cus_phone: input.customer.phoneE164,
      cus_add1: "Dhaka",
      cus_city: "Dhaka",
      cus_country: "Bangladesh",
      success_url: input.urls.success,
      fail_url: input.urls.fail,
      cancel_url: input.urls.cancel,
      opt_a: input.orderNumber,
      type: "json",
    };

    const res = await fetchOutboundJson<{
      result?: string | boolean;
      payment_url?: string;
      error?: string;
    }>(`${host}/jsonpost.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const isSuccess = String(res.result) === "true";
    if (!isSuccess || !res.payment_url) {
      throw new ValidationError(
        undefined,
        `aamarPay session creation failed: ${res.error ?? "unknown error"}`,
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
    const host = getBaseUrl(account.mode);

    const url = `${host}/api/v1/trxcheck/request.php?request_id=${encodeURIComponent(
      ref.tranId,
    )}&store_id=${encodeURIComponent(creds.storeId)}&signature_key=${encodeURIComponent(
      creds.signatureKey,
    )}&type=json`;

    const res = await fetchOutboundJson<{
      pay_status?: string;
      amount?: string;
      currency?: string;
      pg_txnid?: string;
      mer_txnid?: string;
    }>(url);

    const isSuccess = String(res.pay_status ?? "").toLowerCase() === "successful";
    if (!isSuccess) {
      return {
        outcome: "failed",
        raw: res as Record<string, unknown>,
      };
    }

    const amountMinor = res.amount ? Math.round(parseFloat(res.amount) * 100) : undefined;
    const isTranMatch = res.mer_txnid === ref.tranId;
    const isCurrencyMatch = !res.currency || res.currency === "BDT";

    if (!isTranMatch || !isCurrencyMatch) {
      return {
        outcome: "failed",
        amountMinor,
        currency: "BDT",
        gatewayTxnId: res.pg_txnid,
        raw: res as Record<string, unknown>,
      };
    }

    return {
      outcome: "paid",
      amountMinor,
      currency: "BDT",
      gatewayTxnId: res.pg_txnid,
      raw: res as Record<string, unknown>,
    };
  }

  parseCallback(req: CallbackRequest): ParsedCallback {
    const q = req.query;
    const b = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<
      string,
      unknown
    >;

    const tranId =
      typeof q.mer_txnid === "string"
        ? q.mer_txnid
        : typeof b.mer_txnid === "string"
          ? b.mer_txnid
          : undefined;

    const pgTxnId =
      typeof q.pg_txnid === "string"
        ? q.pg_txnid
        : typeof b.pg_txnid === "string"
          ? b.pg_txnid
          : undefined;

    return {
      tranId,
      gatewayRef: pgTxnId,
    };
  }
}

export const aamarPayGateway = new AamarPayGateway();
