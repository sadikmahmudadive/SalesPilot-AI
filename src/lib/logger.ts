/**
 * Redacting JSON logger. Dependency-free (no env / server-only imports).
 * Every log line is one-line JSON with `redact()` applied to the context.
 */

const MASK = '[REDACTED]';
const SENSITIVE_KEY = /key|token|secret|password|authorization|cookie|private/i;
const PHONE_KEY = /phone/i;
const MAX_DEPTH = 8;

/** Keep the last 3 digits of a phone-like string, mask every other digit. */
function maskPhone(value: string): string {
  const total = (value.match(/\d/g) ?? []).length;
  let seen = 0;
  return value.replace(/\d/g, (d) => (++seen > total - 3 ? d : '*'));
}

function walk(value: unknown, key: string | undefined, ancestors: object[], depth: number): unknown {
  if (key !== undefined) {
    if (SENSITIVE_KEY.test(key)) return MASK;
    if (PHONE_KEY.test(key) && typeof value === 'string') return maskPhone(value);
  }

  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null || typeof value !== 'object') return value;

  if (ancestors.includes(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';

  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();

  // Errors: name/message/stack only (never own enumerable props, which may hold secrets).
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  const next = [...ancestors, value];
  if (Array.isArray(value)) return value.map((item) => walk(item, undefined, next, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = walk(v, k, next, depth + 1);
  return out;
}

/** Returns a deep, redacted copy of `obj`. Never mutates the input and never throws on cycles. */
export function redact(obj: unknown): unknown {
  return walk(obj, undefined, [], 0);
}

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, msg: string, ctx?: object): void {
  const safe = ctx === undefined ? {} : (redact(ctx) as Record<string, unknown>);
  let line: string;
  try {
    line = JSON.stringify({ ...safe, level, msg, time: new Date().toISOString() });
  } catch {
    line = JSON.stringify({ level, msg, time: new Date().toISOString(), logError: 'unserializable context' });
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
