import { describe, expect, test } from 'bun:test';
import { requestBonfireGraphQL, BonfireGraphQLError } from '../src/lib/bonfire-graphql.server';
import { FEDIZEN_USER_AGENT, transportDetail } from '../src/lib/fedizen-http';

describe('Fedizen HTTP transport', () => {
  test('GraphQL declares a stable Atlas User-Agent without relying on runtime defaults', async () => {
    let ua = '';
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      ua = (init.headers as Record<string, string>)['user-agent'];
      return new Response(JSON.stringify({ data: { ok: true } }));
    }) as unknown as typeof fetch;
    await requestBonfireGraphQL({ operation: 'query', document: '{ok}', fetchImpl, validate: v => v });
    expect(ua).toBe(FEDIZEN_USER_AGENT);
    expect(ua).toMatch(/^Atlas\//);
  });

  test('connection errors are classified without revealing raw runtime messages or tokens', async () => {
    const secret = 'private-atlas-bearer-secret-should-never-be-logged';
    const failure = new TypeError(`failed to fetch https://fedizen.net?token=${secret}`, {
      cause: Object.assign(new Error(`Connection reset while sending Bearer ${secret}`), { code: 'ECONNRESET' }),
    });
    const fetchImpl = (async () => { throw failure; }) as unknown as typeof fetch;
    const result = await requestBonfireGraphQL({
      operation: 'mutation', document: 'mutation{x}', fetchImpl, validate: v => v,
    }).catch(x => x);
    expect(result).toBeInstanceOf(BonfireGraphQLError);
    expect(result.kind).toBe('network');
    expect(result.detail).toBe('reset');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(String(result)).not.toContain(secret);
  });

  test('transport failures have a bounded, enumerated classification', () => {
    expect(transportDetail('unexpected')).toBe('network');
    expect(transportDetail(new Error('fetch failed', { cause: Object.assign(new Error('resolver failure'), { code: 'ENOTFOUND' }) }))).toBe('dns');
    expect(transportDetail(new DOMException('aborted by timeout', 'TimeoutError'))).toBe('timeout');
    expect(transportDetail(new Error('TLS certificate expired'))).toBe('tls');
    expect(transportDetail(new Error('Connection refused'))).toBe('refused');
    expect(transportDetail(new Error('blocked by policy'))).toBe('blocked');
    expect(transportDetail(new Error('mystery error with private token=123'))).toBe('network');
  });
});

describe('fetch options Cloudflare Workers accept', () => {
  test('no server-side fetch uses redirect: "error" (workerd throws on it)', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const walk = (d: string): string[] => readdirSync(d).flatMap(n => { const p = `${d}/${n}`; return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : []; });
    const offenders = walk('src').filter(f => /redirect:\s*['"]error['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
  test('the runtime refusing an option is told apart', async () => {
    const { transportDetail } = await import('../src/lib/fedizen-http');
    expect(transportDetail(new TypeError('Invalid redirect value, must be one of "follow" or "manual"'))).toBe('unsupported');
    expect(transportDetail(new Error("The 'cache' field on 'RequestInitializerDict' is not implemented."))).toBe('network');
  });
});

describe('disconnecting Fedizen revokes the grant (RFC 7009)', () => {
  test('tries each registration until Fedizen accepts, sending the token and client credentials as a form', async () => {
    const { revokeFedizenToken } = await import('../src/lib/fedizen.server');
    const seen: { url: string; body: URLSearchParams; redirect?: RequestRedirect }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      const body = new URLSearchParams(String(init.body));
      seen.push({ url, body, redirect: init.redirect });
      return new Response('', { status: body.get('client_id') === 'b' ? 200 : 401 });
    }) as unknown as typeof fetch;
    const ok = await revokeFedizenToken('tok', [{ client_id: 'a', client_secret: 'x' }, { client_id: 'b', client_secret: 'y' }, { client_id: 'c', client_secret: 'z' }], fetcher);
    expect(ok).toBe(true);
    expect(seen.map(s => s.body.get('client_id'))).toEqual(['a', 'b']);
    expect(seen[0].url).toBe('https://fedizen.net/oauth/revoke');
    expect(seen[1].body.get('token')).toBe('tok');
    expect(seen[1].body.get('client_secret')).toBe('y');
    expect(seen.every(s => s.redirect === 'manual')).toBe(true);
  });
  test('Fedizen unreachable: reports not revoked, never throws', async () => {
    const { revokeFedizenToken } = await import('../src/lib/fedizen.server');
    const fetcher = (async () => { throw new TypeError('down'); }) as unknown as typeof fetch;
    expect(await revokeFedizenToken('tok', [{ client_id: 'a', client_secret: 'x' }], fetcher)).toBe(false);
  });
});
