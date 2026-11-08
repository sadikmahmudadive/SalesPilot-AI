import {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  RateLimitError,
} from "openai";
import { describe, expect, it, vi } from "vitest";
import { AiProviderError, isAppError } from "../errors";
import failedStream from "./__fixtures__/stream-failed.json";
import maxTokensStream from "./__fixtures__/stream-max-tokens.json";
import textStream from "./__fixtures__/stream-text.json";
import toolCallStream from "./__fixtures__/stream-tool-calls.json";
import { createOpenAiProvider, type OpenAILike } from "./openai-provider";
import type { ChatMessage, ProviderRequest } from "./provider";

type Step = { events?: unknown[]; throwBefore?: Error; throwAfter?: Error };

/** Fake OpenAI client: each `responses.create` call consumes the next scripted step. */
function fakeClient(steps: Step[]) {
  const bodies: Array<Record<string, unknown>> = [];
  const options: Array<Record<string, unknown> | undefined> = [];
  const create = vi.fn(async (body: unknown, opts?: unknown) => {
    bodies.push(body as Record<string, unknown>);
    options.push(opts as Record<string, unknown> | undefined);
    const step = steps[create.mock.calls.length - 1];
    if (!step) throw new Error("fake client: no step left");
    if (step.throwBefore) throw step.throwBefore;
    return (async function* () {
      for (const e of step.events ?? []) yield e;
      if (step.throwAfter) throw step.throwAfter;
    })();
  });
  const client = { responses: { create } } as unknown as OpenAILike;
  return { client, create, bodies, options };
}

const noSleep = vi.fn(async () => {});

function provider(client: OpenAILike) {
  return createOpenAiProvider({ apiKey: "sk-test", client, sleep: noSleep });
}

const baseReq: ProviderRequest = {
  model: "gpt-test",
  system: "You are helpful.",
  messages: [{ role: "user", text: "hi" }],
  tools: [],
  maxOutputTokens: 512,
};

const headers = new Headers();
const SECRET = "SECRET-PROVIDER-TEXT sk-live-123 req_999";
const rateLimit = () => new RateLimitError(429, { message: SECRET }, SECRET, headers);
const serverError = (status = 500) =>
  new InternalServerError(status, { message: SECRET }, SECRET, headers);

describe("request mapping", () => {
  it("sends instructions, model, max_output_tokens, stream and strict function tools", async () => {
    const f = fakeClient([{ events: textStream }]);
    await provider(f.client).generate({
      ...baseReq,
      tools: [
        {
          name: "search_products",
          description: "Search",
          parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
        },
      ],
    });
    const body = f.bodies[0]!;
    expect(body.model).toBe("gpt-test");
    expect(body.instructions).toBe("You are helpful.");
    expect(body.max_output_tokens).toBe(512);
    expect(body.stream).toBe(true);
    expect(body.store).toBe(false);
    expect(body.tools).toEqual([
      {
        type: "function",
        name: "search_products",
        description: "Search",
        parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
        strict: true,
      },
    ]);
  });

  it("omits tools when none are given", async () => {
    const f = fakeClient([{ events: textStream }]);
    await provider(f.client).generate(baseReq);
    expect("tools" in f.bodies[0]!).toBe(false);
  });

  it("maps user, assistant (text + calls) and tool messages to input items", async () => {
    const messages: ChatMessage[] = [
      { role: "user", text: "price of red shirt?" },
      {
        role: "assistant",
        text: "Checking.",
        toolCalls: [{ id: "call_1", name: "search_products", argumentsJson: '{"q":"red"}' }],
      },
      { role: "tool", toolCallId: "call_1", name: "search_products", resultJson: '{"items":[]}' },
      {
        role: "assistant",
        text: "",
        toolCalls: [{ id: "call_2", name: "t", argumentsJson: "{}" }],
      },
      { role: "tool", toolCallId: "call_2", name: "t", resultJson: "{}" },
      { role: "assistant", text: "Done.", toolCalls: [] },
    ];
    const f = fakeClient([{ events: textStream }]);
    await provider(f.client).generate({ ...baseReq, messages });
    expect(f.bodies[0]!.input).toEqual([
      { role: "user", content: "price of red shirt?" },
      { role: "assistant", content: "Checking." },
      {
        type: "function_call",
        call_id: "call_1",
        name: "search_products",
        arguments: '{"q":"red"}',
      },
      { type: "function_call_output", call_id: "call_1", output: '{"items":[]}' },
      { type: "function_call", call_id: "call_2", name: "t", arguments: "{}" },
      { type: "function_call_output", call_id: "call_2", output: "{}" },
      { role: "assistant", content: "Done." },
    ]);
  });

  it("passes the abort signal to the SDK", async () => {
    const f = fakeClient([{ events: textStream }]);
    const controller = new AbortController();
    await provider(f.client).generate({ ...baseReq, signal: controller.signal });
    expect(f.options[0]?.signal).toBe(controller.signal);
  });
});

describe("response mapping", () => {
  it("maps text, usage and stopReason end, streaming deltas in order", async () => {
    const f = fakeClient([{ events: textStream }]);
    const deltas: string[] = [];
    const res = await provider(f.client).generate({
      ...baseReq,
      onTextDelta: (d) => deltas.push(d),
    });
    expect(deltas).toEqual(["Hello", " world"]);
    expect(res).toEqual({
      text: "Hello world",
      toolCalls: [],
      usage: { inputTokens: 120, outputTokens: 7 },
      stopReason: "end",
    });
  });

  it("maps function calls (call_id -> id) and stopReason tool_calls", async () => {
    const f = fakeClient([{ events: toolCallStream }]);
    const res = await provider(f.client).generate(baseReq);
    expect(res.stopReason).toBe("tool_calls");
    expect(res.text).toBe("Let me check.");
    expect(res.toolCalls).toEqual([
      {
        id: "call_abc",
        name: "search_products",
        argumentsJson: '{"query":"red shirt","limit":null}',
      },
      { id: "call_def", name: "get_stock", argumentsJson: '{"productId":"p1"}' },
    ]);
    expect(res.usage).toEqual({ inputTokens: 200, outputTokens: 40 });
  });

  it("maps incomplete due to max_output_tokens to max_tokens", async () => {
    const f = fakeClient([{ events: maxTokensStream }]);
    const res = await provider(f.client).generate(baseReq);
    expect(res.stopReason).toBe("max_tokens");
    expect(res.text).toBe("This reply is cut");
    expect(res.usage).toEqual({ inputTokens: 50, outputTokens: 5 });
  });

  it("is not derailed by an onTextDelta callback that throws", async () => {
    const f = fakeClient([{ events: textStream }]);
    const res = await provider(f.client).generate({
      ...baseReq,
      onTextDelta: () => {
        throw new Error("consumer bug");
      },
    });
    expect(res.text).toBe("Hello world");
  });
});

describe("error mapping and retry", () => {
  const kindOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(AiProviderError);
      return (e as AiProviderError).kind;
    }
    throw new Error("expected rejection");
  };

  it.each([
    ["429", rateLimit(), "rate_limited"],
    ["500", serverError(500), "unavailable"],
    ["503", serverError(503), "unavailable"],
    ["timeout", new APIConnectionTimeoutError(), "timeout"],
  ] as const)("%s retries exactly once, then maps to %s", async (_n, err, kind) => {
    noSleep.mockClear();
    const f = fakeClient([{ throwBefore: err }, { throwBefore: err }, { events: textStream }]);
    expect(await kindOf(provider(f.client).generate(baseReq))).toBe(kind);
    expect(f.create).toHaveBeenCalledTimes(2);
    expect(noSleep).toHaveBeenCalledTimes(1);
  });

  it("succeeds when the retry succeeds", async () => {
    const f = fakeClient([{ throwBefore: rateLimit() }, { events: textStream }]);
    const res = await provider(f.client).generate(baseReq);
    expect(res.text).toBe("Hello world");
    expect(f.create).toHaveBeenCalledTimes(2);
  });

  it("retries a failure raised mid-stream when no text was emitted yet", async () => {
    const f = fakeClient([{ events: [], throwAfter: serverError() }, { events: textStream }]);
    const res = await provider(f.client).generate(baseReq);
    expect(res.text).toBe("Hello world");
    expect(f.create).toHaveBeenCalledTimes(2);
  });

  it("does not retry once text deltas were already emitted (would duplicate output)", async () => {
    const f = fakeClient([
      { events: [textStream[1]], throwAfter: serverError() },
      { events: textStream },
    ]);
    const deltas: string[] = [];
    expect(
      await kindOf(provider(f.client).generate({ ...baseReq, onTextDelta: (d) => deltas.push(d) })),
    ).toBe("unavailable");
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual(["Hello"]);
  });

  it("maps 400 to bad_request without retry", async () => {
    const err = new BadRequestError(400, { message: SECRET }, SECRET, headers);
    const f = fakeClient([{ throwBefore: err }, { events: textStream }]);
    expect(await kindOf(provider(f.client).generate(baseReq))).toBe("bad_request");
    expect(f.create).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404])("maps %i without retry", async (status) => {
    const err = new APIError(status, { message: SECRET }, SECRET, headers);
    const f = fakeClient([{ throwBefore: err }, { events: textStream }]);
    const kind = await kindOf(provider(f.client).generate(baseReq));
    // Bad key (401/403) is our configuration problem: unavailable. 404 (model) is a bad request.
    expect(kind).toBe(status === 404 ? "bad_request" : "unavailable");
    expect(f.create).toHaveBeenCalledTimes(1);
  });

  it("maps an authentication error to unavailable with the static message", async () => {
    const err = new AuthenticationError(
      401,
      { message: "Incorrect API key sk-live-123" },
      "bad key",
      headers,
    );
    const f = fakeClient([{ throwBefore: err }]);
    await expect(provider(f.client).generate(baseReq)).rejects.toMatchObject({
      kind: "unavailable",
      message: "The AI service didn't respond. Try again.",
    });
  });

  it("maps an already-aborted signal to timeout without calling the SDK", async () => {
    const controller = new AbortController();
    controller.abort();
    const f = fakeClient([{ events: textStream }]);
    expect(
      await kindOf(provider(f.client).generate({ ...baseReq, signal: controller.signal })),
    ).toBe("timeout");
    expect(f.create).toHaveBeenCalledTimes(0);
  });

  it("maps an abort raised during the call to timeout without retry", async () => {
    const controller = new AbortController();
    const f = fakeClient([{ events: textStream }, { events: textStream }]);
    f.create.mockImplementationOnce(async () => {
      controller.abort();
      throw new APIUserAbortError();
    });
    expect(
      await kindOf(provider(f.client).generate({ ...baseReq, signal: controller.signal })),
    ).toBe("timeout");
    expect(f.create).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the signal aborts during the backoff", async () => {
    const controller = new AbortController();
    const f = fakeClient([{ throwBefore: rateLimit() }, { events: textStream }]);
    const sleep = vi.fn(async () => controller.abort());
    const p = createOpenAiProvider({ apiKey: "sk-test", client: f.client, sleep });
    expect(await kindOf(p.generate({ ...baseReq, signal: controller.signal }))).toBe("timeout");
    expect(f.create).toHaveBeenCalledTimes(1);
  });

  it("treats a response.failed event as unavailable (retried once)", async () => {
    const f = fakeClient([{ events: failedStream }, { events: failedStream }]);
    expect(await kindOf(provider(f.client).generate(baseReq))).toBe("unavailable");
    expect(f.create).toHaveBeenCalledTimes(2);
  });

  it("treats a stream that ends without a terminal event as unavailable", async () => {
    const f = fakeClient([{ events: [textStream[0]] }, { events: [textStream[0]] }]);
    expect(await kindOf(provider(f.client).generate(baseReq))).toBe("unavailable");
  });

  it("unknown errors become unavailable and are not retried", async () => {
    const f = fakeClient([{ throwBefore: new Error(SECRET) }]);
    expect(await kindOf(provider(f.client).generate(baseReq))).toBe("unavailable");
    expect(f.create).toHaveBeenCalledTimes(1);
  });

  it("never leaks provider text, keys or request ids into the error or the logs", async () => {
    const spies = [
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
    ];
    try {
      for (const err of [
        rateLimit(),
        serverError(),
        new APIError(401, { message: SECRET }, SECRET, headers),
      ]) {
        const f = fakeClient([{ throwBefore: err }, { throwBefore: err }]);
        const caught = await provider(f.client)
          .generate(baseReq)
          .catch((e: unknown) => e);
        expect(caught).toBeInstanceOf(AiProviderError);
        const e = caught as AiProviderError;
        expect(e.message).toBe("The AI service didn't respond. Try again.");
        expect(JSON.stringify(e)).not.toContain("SECRET");
        expect(isAppError(e)).toBe(true);
      }
      const f = fakeClient([{ events: failedStream }, { events: failedStream }]);
      await provider(f.client)
        .generate(baseReq)
        .catch(() => {});
      const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
      expect(logged).not.toContain("SECRET");
      expect(logged).not.toContain("sk-live");
      expect(logged).not.toContain("req_999");
      expect(logged).toContain("rate_limited");
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

describe("AiProviderError", () => {
  it("has a static message and maps bad_request to 502, others to 503", () => {
    expect(new AiProviderError("timeout").status).toBe(503);
    expect(new AiProviderError("rate_limited").status).toBe(503);
    expect(new AiProviderError("unavailable").status).toBe(503);
    expect(new AiProviderError("bad_request").status).toBe(502);
    expect(new AiProviderError("timeout").message).toBe(
      "The AI service didn't respond. Try again.",
    );
  });
});
