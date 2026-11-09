import { describe, expect, mock, test } from 'bun:test';
import {
  parseFedizenOAuthApp, readBoundedFedizenJson,
  redeemFedizenReadCode, registerFedizenOAuthApp,
} from '../src/lib/fedizen.server';

describe('Fedizen OAuth app-registration response boundary', () => {
  test('accepts only bounded nonempty credentials', () => {
    expect(parseFedizenOAuthApp({ client_id: 'app-id', client_secret: 'app-secret' }))
      .toEqual({ client_id: 'app-id', client_secret: 'app-secret' });
    const invalid: unknown[] = [
      null, {}, [], { client_id: 'id' }, { client_id: 3, client_secret: 'secret' },
      { client_id: '', client_secret: 'secret' },
      { client_id: 'id', client_secret: '' },
      { client_id: 'id', client_secret: 'bad' + String.fromCharCode(10) + 'secret' },
      { client_id: 'a'.repeat(4097), client_secret: 'valid' },
      { client_id: 'valid', client_secret: 'x'.repeat(8193) },
    ];
    for (const item of invalid) expect(parseFedizenOAuthApp(item)).toBeNull();
  });

  test('registers only against fixed Fedizen endpoint with redirects disabled', async () => {
    let calls = 0;
    const fetcher = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      expect(String(url)).toBe('https://fedizen.net/api/v1/apps');
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('error');
      expect(init?.cache).toBe('no-store');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.redirect_uris).toBe('https://atlas.lovable.app/fedizen/callback');
      expect(body.scopes).toBe('read');
      return new Response('{"client_id":"id","client_secret":"secret"}');
    }) as typeof fetch;
    expect(await registerFedizenOAuthApp('https://atlas.lovable.app/fedizen/callback', fetcher))
      .toEqual({ client_id: 'id', client_secret: 'secret' });
    expect(calls).toBe(1);
  });

  test('rejects registration with a malformed response and no retries', async () => {
    let calls = 0;
    const fetcher = mock(async () => { calls++; return new Response('{"client_id":"id"}'); }) as typeof fetch;
    await expect(registerFedizenOAuthApp('https://atlas.lovable.app/fedizen/callback', fetcher))
      .rejects.toThrow('invalid OAuth app');
    expect(calls).toBe(1);
  });

  test('rejects a 307 without following it', async () => {
    let calls = 0;
    const fetcher = mock(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      expect(init?.redirect).toBe('error');
      return new Response(null, { status: 307, headers: { location: 'https://untrusted.invalid/register' } });
    }) as typeof fetch;
    await expect(registerFedizenOAuthApp('https://atlas.lovable.app/fedizen/callback', fetcher))
      .rejects.toThrow('unavailable');
    expect(calls).toBe(1);
  });
});

describe('Fedizen authorization-code exchange security', () => {
  const app = { client_id: 'test-client', client_secret: 'private-client-secret' };
  const redirect = 'https://atlas.lovable.app/fedizen/callback';

  test('posts exactly once with no redirects, no caching, and server-only credentials', async () => {
    let calls = 0;
    const fetcher = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      expect(String(url)).toBe('https://fedizen.net/oauth/token');
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('error');
      expect(init?.cache).toBe('no-store');
      expect(new Headers(init?.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
      const payload = new URLSearchParams(String(init?.body));
      expect(payload.get('grant_type')).toBe('authorization_code');
      expect(payload.get('code')).toBe('one-time-code');
      expect(payload.get('redirect_uri')).toBe(redirect);
      expect(payload.get('client_secret')).toBe('private-client-secret');
      expect(payload.get('code_verifier')).toBe('pkce-verifier');
      return new Response('{"access_token":"opaque-token","scope":"read"}');
    }) as typeof fetch;
    expect(await redeemFedizenReadCode('one-time-code', redirect, 'pkce-verifier', app, fetcher))
      .toEqual({ kind: 'ok', grant: { access_token: 'opaque-token', scope: 'read' } });
    expect(calls).toBe(1);
  });

  test('never follows or retries a token-endpoint redirect or HTTP failure', async () => {
    let calls = 0;
    const fetcher = mock(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      expect(init?.redirect).toBe('error');
      return new Response(null, { status: 307, headers: { location: 'https://untrusted.invalid/steal-token' } });
    }) as typeof fetch;
    expect(await redeemFedizenReadCode('code', redirect, 'verifier', app, fetcher)).toEqual({ kind: 'rejected' });
    expect(calls).toBe(1);
  });

  test('a network failure never triggers replay of the one-time code', async () => {
    let calls = 0;
    const fetcher = mock(async () => { calls++; throw new Error('private upstream exception'); }) as typeof fetch;
    expect(await redeemFedizenReadCode('code', redirect, 'verifier', app, fetcher))
      .toEqual({ kind: 'unavailable' });
    expect(calls).toBe(1);
  });

  test('malformed, insufficient and oversize grants never become successful exchanges', async () => {
    const invalidBodies = ['not-json', '{"access_token":"token","scope":"write"}', '{}'];
    for (const body of invalidBodies) {
      const fetcher = mock(async () => new Response(body)) as typeof fetch;
      expect(await redeemFedizenReadCode('code', redirect, 'verifier', app, fetcher)).toEqual({ kind: 'invalid' });
    }
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const fetcher = mock(async () => new Response(body, {
      headers: { 'content-length': '65536' },
    })) as typeof fetch;
    expect(await redeemFedizenReadCode('code', redirect, 'verifier', app, fetcher)).toEqual({ kind: 'invalid' });
    expect(cancelled).toBe(true);
  });
});

describe('shared Fedizen bounded JSON reader', () => {
  test('cancels a response exceeding the limit while streaming', async () => {
    let cancelled = false;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(8192)); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    await expect(readBoundedFedizenJson(new Response(body), 16384)).rejects.toThrow('too large');
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(6);
  });

  test('does not silently return malformed JSON or broken UTF-8', async () => {
    await expect(readBoundedFedizenJson(new Response('not-json'), 1024)).rejects.toThrow();
    const broken = new Response(new Uint8Array([0xff, 0xff]));
    await expect(readBoundedFedizenJson(broken, 1024)).rejects.toThrow();
  });
});
