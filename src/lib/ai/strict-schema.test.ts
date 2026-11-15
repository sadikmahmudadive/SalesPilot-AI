import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toStrictJsonSchema } from "./strict-schema";

// Loose view of the produced JSON Schema for assertions.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("toStrictJsonSchema", () => {
  it("leaves an all-required schema unchanged apart from additionalProperties:false and $schema", () => {
    const schema = z.object({
      name: z.string().min(1).max(40).describe("Product name"),
      kind: z.enum(["a", "b"]),
      count: z.number().min(0).max(10),
    });
    const base = z.toJSONSchema(schema, { io: "input" }) as Json;
    delete base.$schema;
    expect(toStrictJsonSchema(schema)).toEqual({ ...base, additionalProperties: false });
  });

  it("makes optional fields required + nullable", () => {
    const out = toStrictJsonSchema(
      z.object({ q: z.string(), limit: z.number().int().optional() }),
    ) as Json;
    expect(out.required).toEqual(["q", "limit"]);
    expect(out.properties.q.type).toBe("string");
    expect(out.properties.limit.type).toEqual(["integer", "null"]);
  });

  it("adds null to optional enums and drops defaults", () => {
    const out = toStrictJsonSchema(
      z.object({ sort: z.enum(["asc", "desc"]).default("asc") }),
    ) as Json;
    expect(out.required).toEqual(["sort"]);
    expect(out.properties.sort.enum).toEqual(["asc", "desc", null]);
    expect(out.properties.sort.type).toEqual(["string", "null"]);
    expect("default" in out.properties.sort).toBe(false);
  });

  it("keeps genuinely nullable required fields as they are", () => {
    const out = toStrictJsonSchema(z.object({ note: z.string().nullable() })) as Json;
    expect(out.required).toEqual(["note"]);
    expect(out.properties.note.type).toEqual(["string", "null"]);
  });

  it("applies the rules to nested objects and arrays of objects", () => {
    const out = toStrictJsonSchema(
      z.object({
        filter: z.object({ min: z.number().optional(), tag: z.string() }).optional(),
        items: z.array(z.object({ id: z.string(), qty: z.number().optional() })),
      }),
    ) as Json;
    expect(out.additionalProperties).toBe(false);
    expect(out.required).toEqual(["filter", "items"]);

    const filter = out.properties.filter;
    expect(filter.type).toEqual(["object", "null"]);
    expect(filter.additionalProperties).toBe(false);
    expect(filter.required).toEqual(["min", "tag"]);
    expect(filter.properties.min.type).toEqual(["number", "null"]);

    const item = out.properties.items.items;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(["id", "qty"]);
    expect(item.properties.qty.type).toEqual(["number", "null"]);
  });

  it("adds a null branch to optional unions", () => {
    const out = toStrictJsonSchema(
      z.object({
        v: z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]).optional(),
      }),
    ) as Json;
    const branches = out.properties.v.anyOf as Json[];
    expect(branches).toHaveLength(3);
    expect(branches[2]).toEqual({ type: "null" });
    expect(branches[0]!.additionalProperties).toBe(false);
    expect(branches[1]!.additionalProperties).toBe(false);
  });

  it("strips $schema", () => {
    expect("$schema" in toStrictJsonSchema(z.object({ a: z.string() }))).toBe(false);
  });

  it("rejects open-ended records and non-object roots", () => {
    expect(() => toStrictJsonSchema(z.object({ r: z.record(z.string(), z.string()) }))).toThrow();
    expect(() => toStrictJsonSchema(z.string())).toThrow();
  });

  it("rewrites oneOf (discriminated union) to anyOf and strictifies the branches", () => {
    const out = toStrictJsonSchema(
      z.object({
        action: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("a"), x: z.string().optional() }),
          z.object({ kind: z.literal("b"), y: z.number() }),
        ]),
      }),
    ) as Json;
    const action = out.properties.action;
    expect("oneOf" in action).toBe(false);
    expect(action.anyOf).toHaveLength(2);
    expect(action.anyOf[0].additionalProperties).toBe(false);
    expect(action.anyOf[0].required).toEqual(["kind", "x"]);
    expect(action.anyOf[0].properties.x.type).toEqual(["string", "null"]);
  });

  it("makes an optional literal accept null", () => {
    const out = toStrictJsonSchema(z.object({ flag: z.literal("y").optional() })) as Json;
    expect(out.required).toEqual(["flag"]);
    const flag = out.properties.flag;
    expect(flag.anyOf).toEqual([{ type: "string", const: "y" }, { type: "null" }]);
  });

  it("drops the safe-integer bounds Zod adds to ints but keeps real bounds", () => {
    const out = toStrictJsonSchema(
      z.object({ n: z.number().int(), m: z.number().int().min(1).max(50) }),
    ) as Json;
    expect(out.properties.n).toEqual({ type: "integer" });
    expect(out.properties.m).toEqual({ type: "integer", minimum: 1, maximum: 50 });
  });

  it.each([
    ["prefixItems", () => z.object({ t: z.tuple([z.string(), z.number()]) })],
    ["not", () => z.object({ n: z.never() })],
    ["propertyNames", () => z.object({ r: z.record(z.string(), z.string()) })],
  ] as const)("throws naming %s and the schema path", (keyword, make) => {
    expect(() => toStrictJsonSchema(make())).toThrow(new RegExp(`\`${keyword}\``));
  });

  it("names the path of the offending node", () => {
    expect(() =>
      toStrictJsonSchema(z.object({ outer: z.object({ t: z.tuple([z.string()]) }) })),
    ).toThrow(/properties\/outer\/properties\/t/);
  });
});
