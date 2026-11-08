/**
 * TEST SUPPORT ONLY. A scripted ChatProvider for unit and integration tests. Nothing outside
 * test files (and test helpers) may import this module: production code gets its provider from
 * getChatProvider() in openai-provider.ts.
 */
import type { ChatProvider, ProviderRequest, ProviderResult } from "./provider";

export type MockStep =
  ProviderResult | ((req: ProviderRequest) => ProviderResult | Promise<ProviderResult>) | Error;

/**
 * Replays `script` in order, one step per generate() call, recording each request in `calls`.
 * Error steps are thrown. Result text is delivered to `onTextDelta` as a single delta, like a
 * fast stream. An exhausted script throws, so a test that makes an unexpected extra call fails.
 */
export function createMockProvider(
  script: MockStep[],
): ChatProvider & { calls: ProviderRequest[] } {
  const calls: ProviderRequest[] = [];
  let index = 0;
  return {
    calls,
    async generate(req) {
      calls.push(req);
      const step = script[index++];
      if (step === undefined) {
        throw new Error(
          `Mock provider script exhausted at call ${index} (script has ${script.length} steps)`,
        );
      }
      if (step instanceof Error) throw step;
      const result = typeof step === "function" ? await step(req) : step;
      if (result.text) req.onTextDelta?.(result.text);
      return result;
    },
  };
}
