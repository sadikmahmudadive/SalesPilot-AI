/**
 * Redacting JSON logger. Dependency-free (no env / server-only imports).
 * Every log line is one-line JSON with `redact()` applied to the context.
 * Logging must never throw: it is used from inside error handlers.
 */

const MASK = '[REDACTED]';
const UNREADABLE = '[Unreadable]';
const SENSITIVE_KEY = /key|token|secret|password|authorization|auth|cookie|private/i;
const PHONE_KEY = /phone|mobile|msisdn|whatsapp/i;
const MAX_DEPTH = 8;

/** Keep the last 3 digits of a phone-like value, mask every other digit. */
function maskPhone(value: string): string {
  const total = (value.match(/\d/g) ?? []).length;
  let seen = 0;
  return value.replace(/\d/g, (d) => (++seen > total - 3 ? d : '*'));
}

function walk(value: unknown, key: string | undefined, ancestors: object[], depth: number): unknown {
  if (key !== undefined) {
    if (SENSITIVE_KEY.test(key)) return MASK;
    if (PHONE_KEY.test(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint')) {
      return maskPhone(String(value));
    }
  }

  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null || typeof value !== 'object') return value;

  if (ancestors.includes(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';

  // Any trap / getter on a hostile object may throw; one bad value must not sink the log line.
  try {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();

    // Errors: name/message/stack only (never own enumerable props, which may hold secrets).
    if (value instanceof Error) {
      return { name: String(value.name), message: String(value.message), stack: value.stack };
    }

    const next = [...ancestors, value];
    if (Array.isArray(value)) return value.map((_, i) => walkChild(value, i, undefined, next, depth));

    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) out[k] = walkChild(value, k, k, next, depth);
    return out;
  } catch {
    return UNREADABLE;
  }
}

/** Reads one property (may invoke a getter) and walks it; failures become "[Unreadable]". */
function walkChild(
  parent: object,
  prop: string | number,
  key: string | undefined,
  ancestors: object[],
  depth: number,
): unknown {
  try {
    return walk((parent as Record<string | number, unknown>)[prop], key, ancestors, depth + 1);
  } catch {
    return UNREADABLE;
  }
}

/** Returns a deep, redacted copy of `obj`. Never mutates the input; never throws. */
export function redact(obj: unknown): unknown {
  try {
    return walk(obj, undefined, [], 0);
  } catch {
    return UNREADABLE;
  }
}

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, msg: string, ctx?: object): void {
  const time = new Date().toISOString();
  let line: string;
  try {
    const safe = ctx === undefined ? {} : redact(ctx);
    const fields =
      typeof safe === 'object' && safe !== null && !Array.isArray(safe) ? (safe as Record<string, unknown>) : { ctx: safe };
    line = JSON.stringify({ ...fields, level, msg, time });
  } catch {
    try {
      line = JSON.stringify({ level, msg, time, ctx: '[unserializable context]' });
    } catch {
      line = '{"level":"' + level + '","ctx":"[unserializable context]"}';
    }
  }
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

export const logger = {
  info: (msg: string, ctx?: object): void => emit('info', msg, ctx),
  warn: (msg: string, ctx?: object): void => emit('warn', msg, ctx),
  error: (msg: string, ctx?: object): void => emit('error', msg, ctx),
};
