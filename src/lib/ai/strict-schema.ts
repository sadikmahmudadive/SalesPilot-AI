/**
 * Converts a Zod schema into a JSON Schema acceptable to OpenAI function tools with
 * `strict: true` (Structured Outputs rules).
 *
 * NULL-FOR-OPTIONAL CONTRACT (read before writing tool executors):
 * strict mode requires every property to be listed in `required`. A property that is optional
 * in Zod (`.optional()`, `.default()`) therefore becomes REQUIRED + NULLABLE in the schema, and
 * the model sends `null` when it has nothing to say. Tool argument parsing (Task 5) MUST
 * normalise `null` to `undefined` for those fields (recursively) BEFORE running the Zod schema,
 * otherwise `z.string().optional()` rejects `null` and `.default()` is never applied.
 * Properties that are genuinely `.nullable()` in Zod keep their `null` meaning; the
 * normalisation step must only turn null into undefined where the Zod field is optional.
 *
 * Transformations applied to `z.toJSONSchema(schema, { io: 'input' })`:
 *  - `$schema` is removed (not needed, and not part of the function parameters).
 *  - `default` is removed (strict mode rejects it; the default is re-applied by Zod after the
 *    null -> undefined normalisation).
 *  - Every object lists ALL of its properties in `required`.
 *  - Previously optional properties become nullable: `type: "x"` -> `type: ["x", "null"]`,
 *    `enum` gains a `null` member, `anyOf` gains a `{ type: "null" }` branch, and a `const`
 *    (z.literal), `$ref` or untyped node becomes `anyOf: [original, { type: "null" }]` (a
 *    `type` array alongside `const` would still forbid null).
 *  - `oneOf` (z.discriminatedUnion) is rewritten to `anyOf`.
 *  - `minimum`/`maximum` equal to +-Number.MAX_SAFE_INTEGER (added by Zod to plain ints) are
 *    dropped as noise.
 *  - `additionalProperties: false` on every object.
 *  - Keywords strict mode rejects (see UNSUPPORTED_KEYWORDS: prefixItems, uniqueItems, allOf,
 *    not, patternProperties, ...) throw an Error naming the keyword and the schema path, as do
 *    open-ended objects (`z.record`) and a non-object root. These are programmer errors at
 *    tool definition time.
 *
 * Everything else (`description`, `enum`, `minLength`, `minimum`, `items`, ...) is passed
 * through unchanged. Pure module: no env / server-only imports.
 */
import { z, type ZodType } from "zod";

type Json = Record<string, unknown>;

const STRIPPED_KEYS = new Set(["$schema", "default"]);
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/**
 * Keywords OpenAI strict mode rejects (mirrors JSON_SCHEMA_UNSUPPORTED_SCHEMA_KEYWORDS in the
 * openai SDK's lib/transform.js, minus `oneOf`, which is rewritten to `anyOf`). Any of them in
 * a tool schema (z.tuple -> prefixItems, z.set -> uniqueItems, z.intersection -> allOf, ...)
 * throws at conversion time so the mistake surfaces in tests, not on a live call.
 */
const UNSUPPORTED_KEYWORDS = new Set([
  "$anchor",
  "$dynamicAnchor",
  "$dynamicRef",
  "$recursiveAnchor",
  "$recursiveRef",
  "allOf",
  "contains",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
  "dependentRequired",
  "dependentSchemas",
  "dependencies",
  "else",
  "if",
  "maxContains",
  "maxProperties",
  "minContains",
  "minProperties",
  "not",
  "patternProperties",
  "prefixItems",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
  "uniqueItems",
]);

function isPlainObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isObjectSchema(node: Json): boolean {
  const type = node.type;
  return type === "object" || (Array.isArray(type) && type.includes("object"));
}

/** Returns a copy of `node` that also accepts `null`. */
function makeNullable(node: Json): Json {
  const alreadyNull = (n: unknown): boolean =>
    isPlainObject(n) &&
    (n.type === "null" || (Array.isArray(n.type) && n.type.includes("null")) || n.const === null);

  if (alreadyNull(node)) return node;

  // A const cannot be widened in place (`type: [T, "null"]` + `const: x` still forbids null).
  if ("const" in node) return { anyOf: [node, { type: "null" }] };

  const branches = node.anyOf;
  if (Array.isArray(branches)) {
    if (branches.some(alreadyNull)) return node;
    return { ...node, anyOf: [...branches, { type: "null" }] };
  }

  if (typeof node.type === "string" || Array.isArray(node.type)) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    const next: Json = { ...node, type: [...types, "null"] };
    if (Array.isArray(node.enum) && !node.enum.includes(null)) next.enum = [...node.enum, null];
    return next;
  }

  // $ref or an untyped node: wrap.
  return { anyOf: [node, { type: "null" }] };
}

const where = (path: string[]): string => path.join("/") || "<root>";

function convertMap(map: Json, path: string[]): Json {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, convert(v, [...path, k])]));
}

function convert(node: unknown, path: string[]): unknown {
  if (Array.isArray(node)) return node.map((n, i) => convert(n, [...path, String(i)]));
  if (!isPlainObject(node)) return node;

  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (STRIPPED_KEYS.has(key)) continue;
    if (UNSUPPORTED_KEYWORDS.has(key)) {
      throw new Error(
        `Schema at \`${where(path)}\` uses keyword \`${key}\`, which OpenAI strict mode does not support.`,
      );
    }
    if ((key === "minimum" || key === "maximum") && Math.abs(Number(value)) === MAX_SAFE) continue;
    if ((key === "properties" || key === "$defs") && isPlainObject(value)) {
      out[key] = convertMap(value, [...path, key]);
    } else if (key === "enum" || key === "const" || key === "required") {
      out[key] = value;
    } else if (key === "oneOf") {
      // Strict mode only allows anyOf; for tool input unions the two are equivalent in practice.
      out.anyOf = convert(value, [...path, key]);
    } else {
      out[key] = convert(value, [...path, key]);
    }
  }

  if (isObjectSchema(out)) {
    const additional = node.additionalProperties;
    if (isPlainObject(additional) || additional === true) {
      throw new Error(
        `Schema at \`${where(path)}\` is an open-ended object (z.record), which OpenAI strict mode does not support.`,
      );
    }
    const properties = isPlainObject(out.properties) ? out.properties : {};
    const originallyRequired = new Set(
      Array.isArray(node.required) ? (node.required as string[]) : [],
    );
    const nextProps: Json = {};
    for (const [name, prop] of Object.entries(properties)) {
      nextProps[name] = originallyRequired.has(name) ? prop : makeNullable(prop as Json);
    }
    out.properties = nextProps;
    out.required = Object.keys(nextProps);
    out.additionalProperties = false;
  }
  return out;
}

/** Zod schema -> JSON Schema for an OpenAI `strict: true` function tool. See file header. */
export function toStrictJsonSchema(schema: ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { io: "input" }) as Json;
  if (!isObjectSchema(raw)) {
    throw new Error("Strict JSON schema root must be an object schema.");
  }
  return convert(raw, []) as Record<string, unknown>;
}
