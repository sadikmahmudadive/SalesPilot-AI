/**
 * Route handler wrapper. Server-only.
 *
 *   export const POST = withApi({ permission: "customers:write", schema, rateLimit: {...} }, async (ctx) => ...)
 *   export const POST = withAuthOnlyApi({ ... }, async (ctx) => ...)   // no membership yet (registration)
 *
 * Pipeline, in this order (each step short-circuits with a typed error):
 *   1. CSRF / same-origin check (non-GET/HEAD/OPTIONS, unless `csrf: false`)
 *   2. Session user                        -> 401
 *   3. Membership (`withApi` only)         -> 403
 *   4. Permission (`withApi` only)         -> 403
 *   5. Rate limit  `api:${name}:${uid}`    -> 429
 *   6. JSON body parse + Zod validation    -> 400
 *   7. Your handler
 *
 * `organizationId` and `role` come from the membership document, never from the request body,
 * query string or headers. The body schema is the only thing parsed from the client; unknown
 * keys are stripped by default Zod object behaviour.
 *
 * Every response (success, error, or a `Response` you return) gets `x-request-id` and
 * `Cache-Control: no-store`. Anything thrown, including unexpected errors, goes through
 * `toErrorResponse`, which logs details server-side and returns a generic 500 envelope.
 *
 * `csrf: false` is only for signed server-to-server callers (webhooks). Everything else keeps the default.
 */
import "server-only";
import type { ZodIssue, ZodType, z } from "zod";

import { assertJsonSameOrigin } from "@/lib/api/csrf";
import { newRequestId, toErrorResponse } from "@/lib/api/respond";
import { requireMembership } from "@/lib/auth/context";
import { requireUser } from "@/lib/auth/session";
import { ForbiddenError, ValidationError, type ValidationDetail } from "@/lib/errors";
import { can, type Permission, type Role } from "@/lib/security/permissions";
import { assertRateLimit } from "@/lib/security/rate-limit";

export interface RateLimitSpec {
  /** Required so counters of different routes can never collide. Key: `api:${name}:${uid}`. */
  name: string;
  limit: number;
  windowSec: number;
}

interface BaseOptions<S extends ZodType | undefined> {
  rateLimit?: RateLimitSpec;
  /** Zod schema for the JSON body. When set, `Content-Type: application/json` is required. */
  schema?: S;
  /** Same-origin / content-type check on mutating requests. Default true; false only for signed webhooks. */
  csrf?: boolean;
}

export interface ApiOptions<S extends ZodType | undefined = undefined> extends BaseOptions<S> {
  /**
   * REQUIRED so a route can never be left unguarded by omission. `"any-member"` is the explicit
   * opt-out: membership alone suffices. An unknown string at runtime still denies (`can()` fails closed).
   */
  permission: Permission | "any-member";
}
export type AuthOnlyApiOptions<S extends ZodType | undefined = undefined> = BaseOptions<S>;

type BodyOf<S> = S extends ZodType ? z.output<S> : undefined;

export interface AuthOnlyContext<B> {
  uid: string;
  email: string | null;
  body: B;
  req: Request;
  params: Record<string, string>;
  requestId: string;
}

export interface ApiContext<B> extends AuthOnlyContext<B> {
  organizationId: string;
  role: Role;
}

export type RouteContext = { params: Promise<Record<string, string>> };
export type RouteHandler = (req: Request, routeCtx?: RouteContext) => Promise<Response>;
type HandlerResult = Response | object;

// Static text per Zod issue code: never echoes input values (or attacker-chosen key names).
const ISSUE_MESSAGES: Record<string, string> = {
  invalid_type: "Invalid type",
  too_small: "Value is too small or too short",
  too_big: "Value is too large or too long",
  invalid_format: "Invalid format",
  invalid_value: "Invalid value",
  unrecognized_keys: "Unrecognized field",
  not_multiple_of: "Invalid value",
  invalid_union: "Invalid value",
  invalid_key: "Invalid key",
  invalid_element: "Invalid value",
  custom: "Invalid value",
};

/** Field paths plus static messages; the offending input values are never included. */
export function zodIssuesToDetails(issues: ReadonlyArray<Pick<ZodIssue, "code" | "path">>): ValidationDetail[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "body",
    message: ISSUE_MESSAGES[issue.code] ?? "Invalid value",
  }));
}

async function parseBody<S extends ZodType | undefined>(req: Request, schema: S): Promise<BodyOf<S>> {
  if (!schema) return undefined as BodyOf<S>;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    // Missing body and malformed JSON are indistinguishable here and both are a client error.
    throw new ValidationError([{ path: "body", message: "Expected a valid JSON body" }]);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(zodIssuesToDetails(parsed.error.issues));
  return parsed.data as BodyOf<S>;
}

function finalize(res: Response, requestId: string): Response {
  // Rebuild rather than mutate: Response.redirect() / fetch() results have immutable headers.
  const headers = new Headers(res.headers);
  headers.set("x-request-id", requestId);
  headers.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

interface Pipeline<S extends ZodType | undefined, C> {
  opts: BaseOptions<S> & { permission?: Permission | "any-member" };
  withMembership: boolean;
  fn: (ctx: C) => Promise<HandlerResult>;
}

/** Validated once when the route is defined, so a bad spec fails at module load, not per request. */
export function assertValidRateLimitSpec(spec: RateLimitSpec): void {
  const { name, limit, windowSec } = spec;
  if (typeof name !== "string" || name.length === 0 || name.includes(":")) {
    throw new Error("withApi: rateLimit.name must be a non-empty string without ':'");
  }
  if (!Number.isInteger(limit) || limit < 1) throw new Error("withApi: rateLimit.limit must be a positive integer");
  if (!Number.isFinite(windowSec) || Math.floor(windowSec * 1000) < 1) {
    throw new Error("withApi: rateLimit.windowSec must be finite and at least 1 millisecond");
  }
}

/**
 * Next.js control-flow errors (`redirect()`, `notFound()`, `forbidden()`, `unauthorized()`, ...) are
 * thrown errors carrying a string `digest` starting with `NEXT_`; they must reach the framework.
 * `DYNAMIC_SERVER_USAGE` (thrown by `cookies()` / `headers()` during static rendering) is a
 * dynamic-rendering signal of the same kind. A thrown `Response` is deliberately NOT control flow.
 */
export function isNextControlFlowError(err: unknown): boolean {
  if (typeof err !== "object" || err === null || err instanceof Response) return false;
  try {
    const digest = (err as { digest?: unknown }).digest;
    return typeof digest === "string" && (digest.startsWith("NEXT_") || digest === "DYNAMIC_SERVER_USAGE");
  } catch {
    return false;
  }
}

function build<S extends ZodType | undefined, C extends AuthOnlyContext<BodyOf<S>>>(p: Pipeline<S, C>): RouteHandler {
  const { opts, withMembership, fn } = p;
  if (opts.rateLimit) assertValidRateLimitSpec(opts.rateLimit);
  return async (req, routeCtx) => {
    const requestId = newRequestId();
    try {
      if (opts.csrf !== false) assertJsonSameOrigin(req, { requireJson: opts.schema !== undefined });

      const user = await requireUser();
      const org = withMembership ? await requireMembership(user) : undefined;

      if (org && opts.permission !== "any-member" && !can(org.role, opts.permission as Permission)) {
        throw new ForbiddenError();
      }

      if (opts.rateLimit) {
        const { name, limit, windowSec } = opts.rateLimit;
        await assertRateLimit(`api:${name}:${user.uid}`, { limit, windowSec });
      }

      const body = (await parseBody(req, opts.schema)) as BodyOf<S>;
      const params = (await routeCtx?.params) ?? {};
      const base: AuthOnlyContext<BodyOf<S>> = { uid: user.uid, email: user.email, body, req, params, requestId };
      const ctx = (org ? { ...base, organizationId: org.organizationId, role: org.role } : base) as C;

      const result = await fn(ctx);
      return finalize(result instanceof Response ? result : Response.json(result), requestId);
    } catch (err) {
      if (isNextControlFlowError(err)) throw err;
      return finalize(toErrorResponse(err, requestId), requestId);
    }
  };
}

/** Authenticated + organization member. `ctx.organizationId` / `ctx.role` come from membership. */
export function withApi<S extends ZodType | undefined = undefined>(
  opts: ApiOptions<S>,
  fn: (ctx: ApiContext<BodyOf<S>>) => Promise<HandlerResult>,
): RouteHandler {
  return build<S, ApiContext<BodyOf<S>>>({ opts, withMembership: true, fn });
}

/**
 * Authenticated only: for routes a user without an organization must reach (registration).
 * The context deliberately has no `organizationId` / `role`, so callers cannot use them by accident.
 */
export function withAuthOnlyApi<S extends ZodType | undefined = undefined>(
  opts: AuthOnlyApiOptions<S>,
  fn: (ctx: AuthOnlyContext<BodyOf<S>>) => Promise<HandlerResult>,
): RouteHandler {
  return build<S, AuthOnlyContext<BodyOf<S>>>({ opts, withMembership: false, fn });
}
