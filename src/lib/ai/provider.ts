/**
 * Provider-neutral chat types. Pure (types only): importable from tests, server code and
 * (type-wise) anywhere. Concrete adapters live in openai-provider.ts / mock-provider.ts.
 */

export interface ProviderToolCall {
  /** Provider call id (OpenAI `call_id`); echoed back in the matching tool message. */
  id: string;
  name: string;
  /** Raw JSON string exactly as produced by the model (may be malformed; callers parse it). */
  argumentsJson: string;
}

export type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ProviderToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; resultJson: string };

export interface ToolSpec {
  name: string;
  description: string;
  /** Strict JSON schema (see toStrictJsonSchema). */
  parameters: Record<string, unknown>;
}

export interface ProviderRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxOutputTokens: number;
  signal?: AbortSignal;
  /** Called for each streamed output text delta, in order. */
  onTextDelta?: (delta: string) => void;
}

/**
 * Note: a response that stopped with `stopReason: "max_tokens"` can carry TRUNCATED function-call
 * arguments (invalid JSON). Consumers must treat unparseable `argumentsJson` as a malformed call
 * (Task 5 reports it to the model as a tool error) rather than assume it parses.
 */
export interface ProviderResult {
  text: string;
  toolCalls: ProviderToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: "end" | "tool_calls" | "max_tokens";
}

export interface ChatProvider {
  generate(req: ProviderRequest): Promise<ProviderResult>;
}
