import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger, redact } from './logger';

const MASK = '[REDACTED]';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;

describe('redact', () => {
  it('masks sensitive keys at any depth, including arrays', () => {
    const out = redact({
      apiKey: 'a',
      nested: { accessToken: 'b', deeper: [{ password: 'c', ok: 1 }] },
      Authorization: 'Bearer x',
      cookie: 'sid=1',
      PRIVATE_KEY: 'pk',
      client_secret: 's',
      safe: 'keep',
    }) as Rec;
    expect(out.apiKey).toBe(MASK);
    expect(out.nested.accessToken).toBe(MASK);
    expect(out.nested.deeper[0].password).toBe(MASK);
    expect(out.nested.deeper[0].ok).toBe(1);
    expect(out.Authorization).toBe(MASK);
    expect(out.cookie).toBe(MASK);
    expect(out.PRIVATE_KEY).toBe(MASK);
    expect(out.client_secret).toBe(MASK);
    expect(out.safe).toBe('keep');
  });

  it('masks objects/arrays under sensitive keys wholesale', () => {
    const out = redact({ credentials: { token: 't' }, secrets: ['a', 'b'] }) as Record<string, unknown>;
    expect(out.credentials).toEqual({ token: MASK });
    expect(out.secrets).toBe(MASK);
  });

  it('masks phone-like strings under a phone key', () => {
    const out = redact({ phone: '+84 912 345 678', customerPhone: '0912345678', note: '0912345678' }) as Record<
      string,
      string
    >;
    expect(out.phone).not.toContain('912 345');
    expect(out.phone!.endsWith('678')).toBe(true);
    expect(out.customerPhone).not.toBe('0912345678');
    expect(out.customerPhone!.endsWith('678')).toBe(true);
    expect(out.note).toBe('0912345678');
  });

  it('handles circular references without throwing', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    const out = redact(a) as Record<string, unknown>;
    expect(out.name).toBe('a');
    expect(out.self).toBe('[Circular]');
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it('serialises Error objects as name/message/stack only', () => {
    const err = Object.assign(new Error('boom'), { token: 'tok', extra: 'x' });
    const out = redact({ err }) as Rec;
    expect(out.err.name).toBe('Error');
    expect(out.err.message).toBe('boom');
    expect(typeof out.err.stack).toBe('string');
    expect(out.err.token).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('tok"');
  });

  it('passes primitives through and does not mutate input', () => {
    expect(redact(5)).toBe(5);
    expect(redact(null)).toBeNull();
    const input = { password: 'p' };
    redact(input);
    expect(input.password).toBe('p');
  });
});

describe('logger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits one-line redacted JSON via console', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('hello', { token: 'secret-value', n: 1 });
    const spy = info.mock.calls.length ? info : log;
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]![0]);
    expect(line).not.toContain('\n');
    expect(line).not.toContain('secret-value');
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ level: 'info', msg: 'hello', token: MASK, n: 1 });
    expect(typeof parsed.time).toBe('string');
  });

  it('routes warn and error to console.warn / console.error', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.warn('w');
    logger.error('e', { err: new Error('bad') });
    expect(JSON.parse(String(warn.mock.calls[0]![0])).level).toBe('warn');
    const parsed = JSON.parse(String(error.mock.calls[0]![0]));
    expect(parsed.level).toBe('error');
    expect(parsed.err.message).toBe('bad');
  });
});
