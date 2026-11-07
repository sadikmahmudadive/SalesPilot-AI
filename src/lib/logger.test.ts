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

  it('masks auth-like keys (the Cloudinary SDK puts "key:secret" under request_options.auth)', () => {
    const out = redact({
      request_options: { auth: 'key:secret', host: 'api.cloudinary.com' },
      oauth_token: 'o',
      authHeader: 'h',
    }) as Rec;
    expect(out.request_options.auth).toBe(MASK);
    expect(out.request_options.host).toBe('api.cloudinary.com');
    expect(out.oauth_token).toBe(MASK);
    expect(out.authHeader).toBe(MASK);
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

  it('masks number values and mobile/msisdn/whatsapp keys, including inside arrays', () => {
    const out = redact({
      phone: 912345678,
      mobile: '0912 345 678',
      msisdn: '84912345678',
      whatsappNumber: '+84912345678',
      contacts: [{ phone: '0987654321' }],
      note: '0912345678',
    }) as Rec;
    expect(out.phone).toBe('******678');
    expect(out.mobile).toBe('**** *** 678');
    expect(out.msisdn).toBe('********678');
    expect(out.whatsappNumber).toBe('+********678');
    expect(out.contacts[0].phone).toBe('*******321');
    expect(out.note).toBe('0912345678');
  });

  it('turns a throwing getter into [Unreadable] and keeps the rest', () => {
    const obj: Record<string, unknown> = { ok: 1 };
    Object.defineProperty(obj, 'boom', {
      enumerable: true,
      get() {
        throw new Error('getter exploded');
      },
    });
    const out = redact(obj) as Rec;
    expect(out.ok).toBe(1);
    expect(out.boom).toBe('[Unreadable]');
  });

  it('turns a throwing Proxy into [Unreadable]', () => {
    const trap = () => {
      throw new Error('proxy exploded');
    };
    const proxy = new Proxy({}, { ownKeys: trap, get: trap, getPrototypeOf: trap, has: trap });
    const out = redact({ ok: 1, proxy, list: [proxy] }) as Rec;
    expect(out.ok).toBe(1);
    expect(out.proxy).toBe('[Unreadable]');
    expect(out.list[0]).toBe('[Unreadable]');
    expect(redact(proxy)).toBe('[Unreadable]');
  });

  it('stringifies BigInt values', () => {
    expect(redact({ n: BigInt(10) })).toEqual({ n: '10' });
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

describe('logger resilience', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never throws on a throwing getter, throwing Proxy or BigInt context', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad: Record<string, unknown> = { big: BigInt(5) };
    Object.defineProperty(bad, 'boom', {
      enumerable: true,
      get() {
        throw new Error('getter exploded');
      },
    });
    const trap = () => {
      throw new Error('proxy exploded');
    };
    const proxy = new Proxy({}, { ownKeys: trap, get: trap, getPrototypeOf: trap });

    expect(() => logger.error('m', bad)).not.toThrow();
    expect(() => logger.error('m2', proxy)).not.toThrow();
    const first = JSON.parse(String(error.mock.calls[0]![0]));
    expect(first).toMatchObject({ level: 'error', msg: 'm', big: '5', boom: '[Unreadable]' });
    const second = JSON.parse(String(error.mock.calls[1]![0]));
    expect(second).toMatchObject({ level: 'error', msg: 'm2', ctx: '[Unreadable]' });
  });

  it('emits a fallback line if serialization fails', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      throw new Error('stringify exploded');
    });
    expect(() => logger.error('m', { a: 1 })).not.toThrow();
    const parsed = JSON.parse(String(error.mock.calls[0]![0]));
    expect(parsed).toMatchObject({ level: 'error', msg: 'm', ctx: '[unserializable context]' });
  });
});
