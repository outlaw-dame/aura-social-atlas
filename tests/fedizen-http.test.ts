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
