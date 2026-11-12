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

interface MockRecord {
  amountMinor: number;
  currency: "BDT";
  outcome: "paid" | "failed" | "pending";
}

const mockStore = new Map<string, MockRecord>();

export function setMockOutcome(tranId: string, outcome: "paid" | "failed"): void {
  const existing = mockStore.get(tranId);
  if (existing) {
    existing.outcome = outcome;
  } else {
    mockStore.set(tranId, { amountMinor: 0, currency: "BDT", outcome });
  }
}

export function resetMockStore(): void {
  mockStore.clear();
}

export class MockPaymentGateway implements PaymentGateway {
  readonly id = "mock" as const;

  async testConnection(_account: GatewayAccount): Promise<void> {
    void _account;
    return Promise.resolve();
  }

  async createSession(
    _account: GatewayAccount,
    input: CreateSessionInput,
  ): Promise<CreateSessionOutput> {
    void _account;
    mockStore.set(input.tranId, {
      amountMinor: input.amountMinor,
      currency: input.currency,
      outcome: "pending",
    });

    return {
      redirectUrl: `/pay/mock-checkout?tranId=${encodeURIComponent(input.tranId)}`,
      gatewayRef: `mock_ref_${input.tranId}`,
    };
  }

  async verify(
    _account: GatewayAccount,
    ref: VerifyPaymentInput,
  ): Promise<VerifyPaymentOutput> {
    void _account;
    const record = mockStore.get(ref.tranId);
    if (!record) {
      return {
        outcome: "failed",
        raw: { error: "mock_not_found" },
      };
    }

    return {
      outcome: record.outcome,
      amountMinor: record.amountMinor,
      currency: record.currency,
      gatewayTxnId: `mock_txn_${ref.tranId}`,
      raw: { mock: true, state: record.outcome },
    };
  }

  parseCallback(req: CallbackRequest): ParsedCallback {
    const queryTran = typeof req.query.tranId === "string" ? req.query.tranId : undefined;
    const bodyTran =
      typeof req.body === "object" &&
      req.body !== null &&
      "tranId" in req.body &&
      typeof (req.body as { tranId: unknown }).tranId === "string"
        ? (req.body as { tranId: string }).tranId
        : undefined;

    const queryRef = typeof req.query.gatewayRef === "string" ? req.query.gatewayRef : undefined;
    const bodyRef =
      typeof req.body === "object" &&
      req.body !== null &&
      "gatewayRef" in req.body &&
      typeof (req.body as { gatewayRef: unknown }).gatewayRef === "string"
        ? (req.body as { gatewayRef: string }).gatewayRef
        : undefined;

    return {
      tranId: queryTran ?? bodyTran,
      gatewayRef: queryRef ?? bodyRef,
    };
  }
}

export const mockGateway = new MockPaymentGateway();
