import type { GatewayAccount, GatewayProvider } from "@/schemas/integration";

export interface CreateSessionInput {
  tranId: string;
  amountMinor: number;
  currency: "BDT";
  orderNumber: string;
  customer: {
    name: string;
    phoneE164: string;
    email?: string;
  };
  urls: {
    success: string;
    fail: string;
    cancel: string;
    ipn: string;
  };
}

export interface CreateSessionOutput {
  redirectUrl: string;
  gatewayRef?: string;
}

export interface VerifyPaymentInput {
  tranId: string;
  gatewayRef?: string;
}

export interface VerifyPaymentOutput {
  outcome: "paid" | "failed" | "pending";
  amountMinor?: number;
  currency?: "BDT";
  gatewayTxnId?: string;
  riskFlag?: boolean;
  raw: Record<string, unknown>;
}

export interface CallbackRequest {
  query: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown> | unknown;
}

export interface ParsedCallback {
  tranId?: string;
  gatewayRef?: string;
}

export interface PaymentGateway {
  readonly id: GatewayProvider;
  testConnection(account: GatewayAccount): Promise<void>;
  createSession(account: GatewayAccount, input: CreateSessionInput): Promise<CreateSessionOutput>;
  verify(account: GatewayAccount, ref: VerifyPaymentInput): Promise<VerifyPaymentOutput>;
  parseCallback(req: CallbackRequest): ParsedCallback;
}
