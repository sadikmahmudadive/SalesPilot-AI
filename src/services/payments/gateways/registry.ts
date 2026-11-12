import type { GatewayProvider } from "@/schemas/integration";

import { mockGateway } from "./mock";
import type { PaymentGateway } from "./types";

const registry = new Map<GatewayProvider, PaymentGateway>([["mock", mockGateway]]);

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
