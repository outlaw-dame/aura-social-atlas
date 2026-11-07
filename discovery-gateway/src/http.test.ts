import { describe, expect, test } from 'bun:test';
import { createHandler, RateLimiter, tokenMatches } from './http.ts';
import { loadConfig } from './config.ts';
import type { Gateway } from './federation.ts';
import type { Sql } from 'postgres';

describe('admin authentication and request throttling', () => {
  const token = 'abcdef0123456789abcdef0123456789';
  test('accepts only exact bearer tokens', () => {
    expect(tokenMatches(token, token)).toBe(true);
    expect(tokenMatches(token.slice(1), token)).toBe(false);
    expect(tokenMatches(token + 'suffix', token)).toBe(false);
    expect(tokenMatches(null, token)).toBe(false);
    expect(tokenMatches('', token)).toBe(false);
  });
  test('federation admission rejects excess POST before reading bodies or calling Fedify', async () => {
    const cfg = loadConfig({
      GATEWAY_ORIGIN: 'https://gateway.example',
      DATABASE_URL: 'postgres://test:test@localhost/test',
      GATEWAY_ADMIN_TOKEN: token,
      GATEWAY_FEDERATION_RATE_LIMIT: '1',
    });
    let fetchCount = 0;
    const gateway = { fetch: async () => { fetchCount++; return new Response('accepted', { status: 202 }); } } as unknown as Gateway;
    const sql = {} as Sql;
    const handle = createHandler({ cfg, gateway, sql });
    const url = `${cfg.origin}/actors/gateway/inbox`;
    const first = await handle(new Request(url, { method: 'POST', body: 'first' }));
    expect(first.status).toBe(202);
    const refused = await handle(new Request(url, {
      method: 'POST',
      body: new ReadableStream({ pull() { throw new Error('rate-limited body must not be read'); } }, { highWaterMark: 0 }),
      duplex: 'half',
    } as RequestInit));
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('60');
    expect(fetchCount).toBe(1);
    // Untrusted address headers cannot create an independent bucket.
    const bypass = await handle(new Request(url, { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9' }, body: 'bypass' }));
    expect(bypass.status).toBe(429);
    expect(fetchCount).toBe(1);
  });
  test('public ingress refuses admin paths even with valid bearer, forged headers and alternate origins', async () => {
    const cfg = loadConfig({
      GATEWAY_ORIGIN: 'https://gateway.example',
      GATEWAY_ADMIN_TOKEN: token,
      DATABASE_URL: 'postgres://test:test@localhost/test',
    });
    const gw = { fetch: async () => new Response('actor', { status: 200 }) } as unknown as Gateway;
    const sql = {} as Sql;
    const publicHandle = createHandler({ cfg, gateway: gw, sql });
    for (const path of ['/admin', '/admin/subscriptions', '/admin/subscriptions/fake/retry']) {
      for (const base of ['https://gateway.example', 'https://direct-origin.up.railway.app']) {
        const response = await publicHandle(new Request(base + path, {
          headers: {
            authorization: 'Bearer ' + token,
            'x-forwarded-for': '127.0.0.1',
            'cf-connecting-ip': '127.0.0.1',
          },
        }));
        expect(response.status).toBe(404);
        expect(response.headers.get('cache-control')).toBe('no-store');
      }
    }
    const privateHandle = createHandler({ cfg, gateway: gw, sql, adminEnabled: true });
    const rejected = await privateHandle(new Request('http://gateway-web.railway.internal:4101/admin/subscriptions'));
    expect(rejected.status).toBe(401);
  });

  test('private admin listener port must differ from public service port', () => {
    expect(() => loadConfig({
      GATEWAY_ORIGIN: 'https://gateway.example',
      GATEWAY_ADMIN_TOKEN: token,
      DATABASE_URL: 'postgres://test:test@localhost/test',
      PORT: '4100', GATEWAY_ADMIN_PORT: '4100',
    })).toThrow('GATEWAY_ADMIN_PORT must differ');
  });

  test('edge-to-origin authentication rejects direct Railway origin and forged Host on every public route', async () => {
    const edgeSecret = 'cloudflare-origin-only-example-secret-123456789';
    const cfg = loadConfig({
      GATEWAY_ORIGIN: 'https://gateway.example',
      GATEWAY_ADMIN_TOKEN: token,
      DATABASE_URL: 'postgres://test:test@localhost/test',
      GATEWAY_EDGE_SECRET: edgeSecret,
    });
    let calls = 0;
    const gateway = { fetch: async () => { calls++; return new Response('actor', { status: 200 }); } } as unknown as Gateway;
    const sql = {} as Sql;
    const publicHandle = createHandler({ cfg, gateway, sql });
    const livez = await publicHandle(new Request('https://qb9rmgmw.up.railway.app/livez'));
    expect(livez.status).toBe(200);
    expect(livez.headers.get('cache-control')).toBe('no-store');
    expect(await livez.text()).toBe('ok');
    for (const path of ['/healthz', '/actor', '/api/v1/items', '/admin/subscriptions']) {
      for (const host of ['gateway.example', 'qb9rmgmw.up.railway.app']) {
        for (const supplied of [undefined, 'invalid-secret']) {
          const headers: Record<string, string> = { host: 'gateway.example', 'cf-connecting-ip': '127.0.0.1' };
          if (supplied) headers['x-atlas-edge-auth'] = supplied;
          const response = await publicHandle(new Request('https://' + host + path, { headers }));
          expect(response.status).toBe(403);
          expect(response.headers.get('cache-control')).toBe('no-store');
        }
      }
    }
    expect(calls).toBe(0);
    const allowed = await publicHandle(new Request('https://gateway.example/actor', {
      headers: { 'x-atlas-edge-auth': edgeSecret },
    }));
    expect(allowed.status).toBe(200);
    expect(calls).toBe(1);
    const deniedAdmin = await publicHandle(new Request('https://gateway.example/admin/subscriptions', {
      headers: { 'x-atlas-edge-auth': edgeSecret, authorization: 'Bearer ' + token },
    }));
    expect(deniedAdmin.status).toBe(404);
    const privateAdmin = createHandler({ cfg, gateway, sql, adminEnabled: true });
    const privateCheck = await privateAdmin(new Request('http://gateway-web.railway.internal:4101/admin/subscriptions'));
    expect(privateCheck.status).toBe(401);
  });

  test('rejects underlength edge secrets at configuration time', () => {
    expect(() => loadConfig({
      GATEWAY_ORIGIN: 'https://gateway.example',
      DATABASE_URL: 'postgres://test:test@localhost/test',
      GATEWAY_ADMIN_TOKEN: token,
      GATEWAY_EDGE_SECRET: 'too-short',
    })).toThrow('GATEWAY_EDGE_SECRET');
  });

  test('rate limiter closes the bucket after the configured count', () => {
    const limiter = new RateLimiter(2);
    expect(limiter.allow('anonymous')).toBe(true);
    expect(limiter.allow('anonymous')).toBe(true);
    expect(limiter.allow('anonymous')).toBe(false);
    expect(limiter.allow('different')).toBe(true);
  });
});
