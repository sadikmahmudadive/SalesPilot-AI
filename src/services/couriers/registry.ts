import type { CourierProvider } from "@/schemas/courier";

import { mockCourierAdapter } from "./adapters/mock";
import { pathaoAdapter } from "./adapters/pathao";
import { redxAdapter } from "./adapters/redx";
import { steadfastAdapter } from "./adapters/steadfast";
import type { CourierAdapter } from "./types";

const registry = new Map<CourierProvider, CourierAdapter>([
  ["mock", mockCourierAdapter],
  ["steadfast", steadfastAdapter],
  ["pathao", pathaoAdapter],
  ["redx", redxAdapter],
]);

export function registerCourierAdapter(adapter: CourierAdapter): void {
  registry.set(adapter.id, adapter);
}

export function getCourierAdapter(provider: CourierProvider): CourierAdapter {
  const adapter = registry.get(provider);
  if (!adapter) {
    throw new Error(`Unsupported courier provider: ${provider}`);
  }
  return adapter;
}
