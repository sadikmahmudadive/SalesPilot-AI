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
 *    `enum` gains a `null` member, `anyOf`/`oneOf` gains a `{ type: "null" }` branch, and a
 *    `$ref` / `const` becomes `anyOf: [original, { type: "null" }]`.
 *  - `additionalProperties: false` on every object.
 *  - `propertyNames` is removed; open-ended objects (`z.record`) cannot be expressed in strict
 *    mode and throw, as does a non-object root. Both are programmer errors at tool definition.
 *
 * Everything else (`description`, `enum`, `minLength`, `minimum`, `items`, ...) is passed
 * through unchanged. Pure module: no env / server-only imports.
 */
import { z, type ZodType } from "zod";

type Json = Record<string, unknown>;

const STRIPPED_KEYS = new Set(["$schema", "default", "propertyNames"]);

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

  for (const key of ["anyOf", "oneOf"] as const) {
    const branches = node[key];
    if (Array.isArray(branches)) {
      if (branches.some(alreadyNull)) return node;
      return { ...node, [key]: [...branches, { type: "null" }] };
    }
  }

  if (typeof node.type === "string") {
    const next: Json = { ...node, type: [node.type, "null"] };
    if (Array.isArray(node.enum) && !node.enum.includes(null)) next.enum = [...node.enum, null];
    return next;
  }
  if (Array.isArray(node.type)) {
    const next: Json = { ...node, type: [...node.type, "null"] };
    if (Array.isArray(node.enum) && !node.enum.includes(null)) next.enum = [...node.enum, null];
    return next;
  }

  // $ref, const, or an untyped node: wrap.
  return { anyOf: [node, { type: "null" }] };
}

function convert(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convert);
  if (!isPlainObject(node)) return node;

  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (STRIPPED_KEYS.has(key)) continue;
    if (key === "properties" && isPlainObject(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(v)]));
    } else if (key === "$defs" && isPlainObject(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(v)]));
    } else if (key === "enum" || key === "const" || key === "required") {
      out[key] = value;
    } else {
      out[key] = convert(value);
    }
  }

  if (isObjectSchema(out)) {
    const additional = node.additionalProperties;
    if (isPlainObject(additional) || additional === true) {
      throw new Error("Strict JSON schema does not support open-ended objects (z.record).");
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
  return convert(raw) as Record<string, unknown>;
}
