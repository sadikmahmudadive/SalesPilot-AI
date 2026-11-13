import { ValidationError } from "@/lib/errors";
import type { VoiceProvider } from "@/schemas/voice";

import { mockVoiceAdapter } from "./adapters/mock";
import { twilioVoiceAdapter } from "./adapters/twilio";
import { vapiVoiceAdapter } from "./adapters/vapi";
import type { VoiceProviderAdapter } from "./types";

const ADAPTERS: Record<VoiceProvider, VoiceProviderAdapter> = {
  vapi: vapiVoiceAdapter,
  twilio: twilioVoiceAdapter,
  mock: mockVoiceAdapter,
};

export function getVoiceAdapter(provider: VoiceProvider): VoiceProviderAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new ValidationError(undefined, `Unsupported voice provider: ${provider}`);
  }
  return adapter;
}
