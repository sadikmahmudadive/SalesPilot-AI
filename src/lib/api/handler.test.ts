import { describe, expect, it } from "vitest";
import { z } from "zod";

import { zodIssuesToDetails } from "./handler";

describe("zodIssuesToDetails", () => {
  it("maps issues to field paths with static messages and never echoes input", () => {
    const secret = "TOP-SECRET-INPUT";
    const result = z
      .object({ a: z.string().min(2), nested: z.object({ n: z.number() }), only: z.literal("x") })
      .strict()
      .safeParse({ a: 1, nested: { n: secret }, only: secret, [secret]: secret });
    expect(result.success).toBe(false);
    if (result.success) return;
    const details = zodIssuesToDetails(result.error.issues);
    expect(details.map((d) => d.path)).toEqual(expect.arrayContaining(["a", "nested.n", "only"]));
    expect(JSON.stringify(details)).not.toContain(secret);
    for (const d of details) expect(typeof d.message).toBe("string");
  });

  it("uses 'body' for root-level issues", () => {
    const result = z.string().safeParse(5);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodIssuesToDetails(result.error.issues)).toEqual([{ path: "body", message: "Invalid type" }]);
  });
});
