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

interface SSLCommerzCredentials {
  storeId: string;
  storePassword: string;
}

function getCredentials(account: GatewayAccount): SSLCommerzCredentials {
  const json = unsealSecret(account.credentials);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const storeId = typeof parsed.storeId === "string" ? parsed.storeId.trim() : "";
  const storePassword = typeof parsed.storePassword === "string" ? parsed.storePassword.trim() : "";

  if (!storeId || !storePassword) {
    throw new ValidationError(
      undefined,
      "SSLCommerz requires storeId and storePassword credentials",
    );
  }

  return { storeId, storePassword };
}

function getBaseUrl(mode: GatewayAccount["mode"]): string {
  return mode === "live"
    ? "https://securepay.sslcommerz.com"
    : "https://sandbox.sslcommerz.com";
}

export class SSLCommerzGateway implements PaymentGateway {
  readonly id = "sslcommerz" as const;

  async testConnection(account: GatewayAccount): Promise<void> {
    const creds = getCredentials(account);
    const host = getBaseUrl(account.mode);

    // Call validation server with a dummy val_id to verify store credentials
    const url = `${host}/validator/api/validationserverAPI.php?val_id=test_ping&store_id=${encodeURIComponent(
      creds.storeId,
    )}&store_passwd=${encodeURIComponent(creds.storePassword)}&v=1&format=json`;

    const res = await fetchOutboundJson<Record<string, unknown>>(url);
    const status = String(res.status ?? "").toUpperCase();
    if (status === "FAILED" && String(res.failedreason ?? "").toLowerCase().includes("store")) {
      throw new ValidationError(undefined, "SSLCommerz credentials rejected: Store ID or Password invalid");
    }
  }

  async createSession(
    account: GatewayAccount,
    input: CreateSessionInput,
  ): Promise<CreateSessionOutput> {
    const creds = getCredentials(account);
    const host = getBaseUrl(account.mode);

    const amountDecimal = (input.amountMinor / 100).toFixed(2);

    const form = new URLSearchParams({
      store_id: creds.storeId,
      store_passwd: creds.storePassword,
      total_amount: amountDecimal,
      currency: "BDT",
      tran_id: input.tranId,
      success_url: input.urls.success,
      fail_url: input.urls.fail,
      cancel_url: input.urls.cancel,
      ipn_url: input.urls.ipn,
      cus_name: input.customer.name,
      cus_phone: input.customer.phoneE164,
      cus_email: input.customer.email ?? "customer@example.com",
      cus_add1: "Dhaka",
      cus_city: "Dhaka",
      cus_country: "Bangladesh",
      shipping_method: "NO",
      product_name: input.orderNumber,
      product_category: "General",
      product_profile: "general",
    });

    const res = await fetchOutboundJson<{
      status?: string;
      failedreason?: string;
      GatewayPageURL?: string;
      sessionkey?: string;
    }>(`${host}/gwprocess/v4/api.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    if (res.status !== "SUCCESS" || !res.GatewayPageURL) {
      throw new ValidationError(
        undefined,
        `SSLCommerz session creation failed: ${res.failedreason ?? "unknown error"}`,
      );
    }

    return {
      redirectUrl: res.GatewayPageURL,
      gatewayRef: res.sessionkey,
    };
  }

  async verify(
    account: GatewayAccount,
    ref: VerifyPaymentInput,
  ): Promise<VerifyPaymentOutput> {
    const creds = getCredentials(account);
    const host = getBaseUrl(account.mode);

    const valId = ref.gatewayRef ?? "";
    if (!valId) {
      return {
        outcome: "failed",
        raw: { error: "Missing val_id for SSLCommerz verification" },
      };
    }

    const url = `${host}/validator/api/validationserverAPI.php?val_id=${encodeURIComponent(
      valId,
    )}&store_id=${encodeURIComponent(creds.storeId)}&store_passwd=${encodeURIComponent(
      creds.storePassword,
    )}&v=1&format=json`;

    const res = await fetchOutboundJson<{
      status?: string;
      amount?: string;
      currency?: string;
      tran_id?: string;
      bank_tran_id?: string;
      risk_level?: string | number;
    }>(url);

    const status = String(res.status ?? "").toUpperCase();
    const isValid = status === "VALID" || status === "VALIDATED";

    if (!isValid) {
      return {
        outcome: "failed",
        raw: res as Record<string, unknown>,
      };
    }

    const amountMinor = res.amount ? Math.round(parseFloat(res.amount) * 100) : undefined;
    const isTranMatch = res.tran_id === ref.tranId;
    const isCurrencyMatch = res.currency === "BDT";

    if (!isTranMatch || !isCurrencyMatch) {
      return {
        outcome: "failed",
        amountMinor,
        currency: "BDT",
        gatewayTxnId: res.bank_tran_id,
        raw: res as Record<string, unknown>,
      };
    }

    const riskFlag = String(res.risk_level ?? "0") === "1";

    return {
      outcome: "paid",
      amountMinor,
      currency: "BDT",
      gatewayTxnId: res.bank_tran_id,
      riskFlag,
      raw: res as Record<string, unknown>,
    };
  }

  parseCallback(req: CallbackRequest): ParsedCallback {
    const q = req.query;
    const b = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<
      string,
      unknown
    >;

    const valId =
      typeof q.val_id === "string"
        ? q.val_id
        : typeof b.val_id === "string"
          ? b.val_id
          : undefined;

    const tranId =
      typeof q.tran_id === "string"
        ? q.tran_id
        : typeof b.tran_id === "string"
          ? b.tran_id
          : undefined;

    return {
      gatewayRef: valId,
      tranId,
    };
  }
}

export const sslcommerzGateway = new SSLCommerzGateway();
