import type { GatewayProvider } from "@/schemas/integration";

import { aamarPayGateway } from "./aamarpay";
import { mockGateway } from "./mock";
import { sslcommerzGateway } from "./sslcommerz";
import type { PaymentGateway } from "./types";
import { uddoktaPayGateway } from "./uddoktapay";

const registry = new Map<GatewayProvider, PaymentGateway>([
  ["mock", mockGateway],
  ["sslcommerz", sslcommerzGateway],
  ["aamarpay", aamarPayGateway],
  ["uddoktapay", uddoktaPayGateway],
]);

export function registerPaymentGateway(gateway: PaymentGateway): void {
  registry.set(gateway.id, gateway);
}

export function getPaymentGateway(provider: GatewayProvider): PaymentGateway {
  const gateway = registry.get(provider);
  if (!gateway) {
    throw new Error(`Unsupported payment gateway provider: ${provider}`);
  }
  return gateway;
}
