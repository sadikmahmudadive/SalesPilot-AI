import { describe, expect, it } from "vitest";
import { createMockProvider } from "./mock-provider";
import type { ProviderRequest, ProviderResult } from "./provider";

const req = (text: string): ProviderRequest => ({
  model: "m",
  system: "s",
  messages: [{ role: "user", text }],
  tools: [],
  maxOutputTokens: 100,
});

const result = (text: string): ProviderResult => ({
  text,
  toolCalls: [],
  usage: { inputTokens: 1, outputTokens: 1 },
  stopReason: "end",
});

describe("createMockProvider", () => {
  it("replays the script in order and records requests", async () => {
    const mock = createMockProvider([result("one"), result("two")]);
    expect((await mock.generate(req("a"))).text).toBe("one");
    expect((await mock.generate(req("b"))).text).toBe("two");
    expect(mock.calls.map((c) => c.messages[0])).toEqual([
      { role: "user", text: "a" },
      { role: "user", text: "b" },
    ]);
  });

  it("supports function steps (sync and async) that see the request", async () => {
    const mock = createMockProvider([
      (r) => result(`echo:${(r.messages[0] as { text: string }).text}`),
      async () => result("later"),
    ]);
    expect((await mock.generate(req("x"))).text).toBe("echo:x");
    expect((await mock.generate(req("y"))).text).toBe("later");
  });

  it("throws scripted errors", async () => {
    const boom = new Error("boom");
    const mock = createMockProvider([boom, result("ok")]);
    await expect(mock.generate(req("a"))).rejects.toBe(boom);
    expect((await mock.generate(req("b"))).text).toBe("ok");
    expect(mock.calls).toHaveLength(2);
  });

  it("streams the scripted text to onTextDelta", async () => {
    const mock = createMockProvider([result("hello")]);
    const deltas: string[] = [];
    await mock.generate({ ...req("a"), onTextDelta: (d) => deltas.push(d) });
    expect(deltas.join("")).toBe("hello");
  });

  it("fails loudly when the script is exhausted", async () => {
    const mock = createMockProvider([]);
    await expect(mock.generate(req("a"))).rejects.toThrow(/script/i);
  });
});
