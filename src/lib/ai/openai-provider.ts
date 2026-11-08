/**
 * OpenAI Responses API adapter for the neutral ChatProvider interface.
 *
 * Uses the streaming Responses API (`responses.create({ stream: true })`): text deltas are
 * forwarded to `onTextDelta`; the final text, function calls and usage are read from the
 * terminal `response.completed` / `response.incomplete` event.
 *
 * Retry policy: exactly one retry after a short backoff on 429, 5xx, 408, connection and
 * timeout errors. Never retried: 400/401/403/404 and other 4xx, an aborted signal (-> timeout),
 * unknown errors, and any failure after text deltas were already emitted (a retry would
 * duplicate output to the consumer).
 *
 * Timeouts: the SDK client timeout (30 s) only covers the wait for response headers; once the
 * stream is open it no longer applies. Callers MUST therefore pass the turn-budget `signal`
 * so a stalled stream is cut off (it maps to `timeout`).
 *
 * Errors: everything surfaces as AiProviderError with a static message. Provider error text,
 * request ids and keys are never copied into the message or logs; only `kind` and the HTTP
 * status are logged.
 */
import "server-only";

import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "openai";
import type {
  FunctionTool,
  Response,
  ResponseCreateParamsStreaming,
  ResponseInputItem,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";

import { getServerEnv, isConfigured } from "../../config/env";
import {
  AiProviderError,
  IntegrationNotConfiguredError,
  type AiProviderErrorKind,
} from "../errors";
import { logger } from "../logger";
import type {
  ChatMessage,
  ChatProvider,
  ProviderRequest,
  ProviderResult,
  ProviderToolCall,
} from "./provider";

/** The slice of the OpenAI client this adapter uses; lets tests inject a fake. */
export interface OpenAILike {
  responses: {
    create(
      body: ResponseCreateParamsStreaming,
      options?: { signal?: AbortSignal },
    ): PromiseLike<AsyncIterable<ResponseStreamEvent>>;
  };
}

export interface OpenAiProviderOptions {
  apiKey: string;
  client?: OpenAILike;
  /** Backoff before the single retry. Injectable so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  backoffMs?: number;
}

const DEFAULT_BACKOFF_MS = 750;
const CLIENT_TIMEOUT_MS = 30_000;

/** A stream that failed (`response.failed` / `error` event) or ended without a terminal event. */
class StreamFailure extends Error {}

interface Classified {
  kind: AiProviderErrorKind;
  retryable: boolean;
  httpStatus?: number;
}

function classify(err: unknown, signal: AbortSignal | undefined): Classified {
  if (signal?.aborted || err instanceof APIUserAbortError) {
    return { kind: "timeout", retryable: false };
  }
  if (err instanceof APIConnectionTimeoutError) return { kind: "timeout", retryable: true };
  if (err instanceof APIConnectionError || err instanceof StreamFailure) {
    return { kind: "unavailable", retryable: true };
  }
  if (err instanceof APIError && typeof err.status !== "number") {
    // An SSE `error` event inside the stream surfaces as an APIError without an HTTP status.
    return { kind: "unavailable", retryable: true };
  }
  if (err instanceof APIError && typeof err.status === "number") {
    const s = err.status;
    if (s === 429) return { kind: "rate_limited", retryable: true, httpStatus: s };
    if (s >= 500) return { kind: "unavailable", retryable: true, httpStatus: s };
    if (s === 408) return { kind: "timeout", retryable: true, httpStatus: s };
    // A rejected key is our configuration problem, not the caller's request.
    if (s === 401 || s === 403) return { kind: "unavailable", retryable: false, httpStatus: s };
    return { kind: "bad_request", retryable: false, httpStatus: s };
  }
  return { kind: "unavailable", retryable: false };
}

function toInput(messages: ChatMessage[]): ResponseInputItem[] {
  const input: ResponseInputItem[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      input.push({ role: "user", content: m.text });
    } else if (m.role === "assistant") {
      if (m.text) input.push({ role: "assistant", content: m.text });
      for (const call of m.toolCalls) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: call.argumentsJson,
        });
      }
    } else {
      input.push({ type: "function_call_output", call_id: m.toolCallId, output: m.resultJson });
    }
  }
  return input;
}

function readResponse(final: Response, streamedText: string): ProviderResult {
  let text = "";
  const toolCalls: ProviderToolCall[] = [];
  for (const item of final.output ?? []) {
    if (item.type === "message") {
      for (const part of item.content) {
        if (part.type === "output_text") text += part.text;
        else if (part.type === "refusal") text += part.refusal;
      }
    } else if (item.type === "function_call") {
      toolCalls.push({ id: item.call_id, name: item.name, argumentsJson: item.arguments });
    }
  }
  if (!text) text = streamedText;

  const stopReason: ProviderResult["stopReason"] =
    toolCalls.length > 0
      ? "tool_calls"
      : final.status === "incomplete" && final.incomplete_details?.reason === "max_output_tokens"
        ? "max_tokens"
        : "end";

  return {
    text,
    toolCalls,
    usage: {
      inputTokens: final.usage?.input_tokens ?? 0,
      outputTokens: final.usage?.output_tokens ?? 0,
    },
    stopReason,
  };
}

export function createOpenAiProvider(opts: OpenAiProviderOptions): ChatProvider {
  const client: OpenAILike =
    opts.client ?? new OpenAI({ apiKey: opts.apiKey, maxRetries: 0, timeout: CLIENT_TIMEOUT_MS });
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS;

  async function attempt(
    req: ProviderRequest,
    state: { emitted: boolean },
  ): Promise<ProviderResult> {
    const tools: FunctionTool[] = req.tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      strict: true,
    }));
    const body: ResponseCreateParamsStreaming = {
      model: req.model,
      instructions: req.system,
      input: toInput(req.messages),
      max_output_tokens: req.maxOutputTokens,
      stream: true,
      store: false,
      ...(tools.length > 0 ? { tools } : {}),
    };

    const stream = await client.responses.create(
      body,
      req.signal ? { signal: req.signal } : undefined,
    );

    let streamedText = "";
    let final: Response | undefined;
    for await (const event of stream) {
      switch (event.type) {
        case "response.output_text.delta":
        case "response.refusal.delta": {
          state.emitted = true;
          streamedText += event.delta;
          try {
            req.onTextDelta?.(event.delta);
          } catch {
            // A faulty consumer must not abort generation.
          }
          break;
        }
        case "response.completed":
        case "response.incomplete":
          final = event.response;
          break;
        case "response.failed":
        case "error":
          throw new StreamFailure();
        default:
          break;
      }
    }
    if (!final) throw new StreamFailure();
    return readResponse(final, streamedText);
  }

  return {
    async generate(req) {
      let retried = false;
      for (;;) {
        if (req.signal?.aborted) throw new AiProviderError("timeout");
        const state = { emitted: false };
        try {
          return await attempt(req, state);
        } catch (err) {
          const c = classify(err, req.signal);
          const canRetry = !retried && c.retryable && !state.emitted;
          // Only kind + HTTP status are logged: never provider text, request ids or keys.
          logger.warn(canRetry ? "ai_provider_retry" : "ai_provider_error", {
            kind: c.kind,
            httpStatus: c.httpStatus,
          });
          if (!canRetry) throw new AiProviderError(c.kind);
          retried = true;
          await sleep(backoffMs);
        }
      }
    },
  };
}

let cached: { apiKey: string; provider: ChatProvider } | undefined;

/** Provider for the configured OpenAI account. Throws IntegrationNotConfiguredError without a key. */
export function getChatProvider(): ChatProvider {
  if (!isConfigured("openai")) throw new IntegrationNotConfiguredError("openai");
  const apiKey = getServerEnv().OPENAI_API_KEY as string;
  if (!cached || cached.apiKey !== apiKey) {
    cached = { apiKey, provider: createOpenAiProvider({ apiKey }) };
  }
  return cached.provider;
}
