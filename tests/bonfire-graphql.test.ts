import { describe, expect, test, mock } from 'bun:test';
import { BonfireGraphQLError, requestBonfireGraphQL } from '../src/lib/bonfire-graphql.server';

const accept = (data: unknown) => {
  if (!data || typeof data !== 'object' || (data as Record<string, unknown>).ok !== true) throw Error('invalid');
  return data as { ok: true };
};
const query = (overrides: Record<string, unknown> = {}) => ({
  operation: 'query' as const,
  document: 'query AtlasTest { ok }',
  validate: accept,
  waitImpl: async () => {},
  ...overrides,
});

const ok = () => new Response('{"data":{"ok":true}}', { status: 200 });
const response = (status: number) => new Response('', { status });

describe('server-only Bonfire GraphQL transport', () => {
  test('uses only fixed Fedizen URL and carries bearer only when explicitly supplied', async () => {
    let requestCount = 0;
    const fetchImpl = mock(async (url: string | URL | Request, init?: RequestInit) => {
      requestCount++;
      expect(String(url)).toBe('https://fedizen.net/api/graphql');
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('error');
      expect(init?.cache).toBe('no-store');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer opaque-token');
      expect(JSON.parse(String(init?.body)).query).toContain('AtlasTest');
      return ok();
    }) as typeof fetch;
    expect(await requestBonfireGraphQL(query({ fetchImpl, accessToken: 'opaque-token' }))).toEqual({ ok: true });
    expect(requestCount).toBe(1);
  });

  test('anonymous request omits authorization header', async () => {
    const fetchImpl = mock(async (_: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      return ok();
    }) as typeof fetch;
    expect(await requestBonfireGraphQL(query({ fetchImpl }))).toEqual({ ok: true });
  });

  test('transient query HTTP 503 uses bounded retries', async () => {
    let calls = 0;
    const waits: number[] = [];
    const fetchImpl = mock(async () => (++calls < 3 ? response(503) : ok())) as typeof fetch;
    const value = await requestBonfireGraphQL(query({
      fetchImpl,
      waitImpl: async (ms: number) => { waits.push(ms); },
    }));
    expect(value).toEqual({ ok: true });
    expect(calls).toBe(3);
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(0);
    expect(waits[0]).toBeLessThanOrEqual(200);
    expect(waits[1]).toBeGreaterThanOrEqual(0);
    expect(waits[1]).toBeLessThanOrEqual(400);
  });

  test('HTTP 401 is not retried', async () => {
    let calls = 0;
    const fetchImpl = mock(async () => { calls++; return response(401); }) as typeof fetch;
    await expect(requestBonfireGraphQL(query({ fetchImpl }))).rejects.toMatchObject({ kind: 'http', status: 401 });
    expect(calls).toBe(1);
  });

  test('query network errors have a strict three-attempt ceiling', async () => {
    let calls = 0;
    const fetchImpl = mock(async () => { calls++; throw Error('private transport message'); }) as typeof fetch;
    await expect(requestBonfireGraphQL(query({ fetchImpl }))).rejects.toMatchObject({ kind: 'network' });
    expect(calls).toBe(3);
  });

  test('a mutation is never retried after server failure', async () => {
    let calls = 0;
    const fetchImpl = mock(async () => { calls++; return response(503); }) as typeof fetch;
    await expect(requestBonfireGraphQL({
      operation: 'mutation', document: 'mutation AtlasTest { ok }', validate: accept, fetchImpl,
    })).rejects.toMatchObject({ kind: 'http', status: 503 });
    expect(calls).toBe(1);
  });

  test('partial data with GraphQL errors fails closed and is never retried', async () => {
    let calls = 0;
    const fetchImpl = mock(async () => {
      calls++;
      return new Response(JSON.stringify({ data: { ok: true }, errors: [{ message: 'sensitive' }] }));
    }) as typeof fetch;
    await expect(requestBonfireGraphQL(query({ fetchImpl }))).rejects.toMatchObject({ kind: 'graphql' });
    expect(calls).toBe(1);
  });

  test('invalid data is rejected by the supplied response validator', async () => {
    const fetchImpl = mock(async () => new Response('{"data":{"ok":false}}')) as typeof fetch;
    await expect(requestBonfireGraphQL(query({ fetchImpl }))).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  test('malformed JSON does not produce a successful result', async () => {
    const fetchImpl = mock(async () => new Response('not json')) as typeof fetch;
    await expect(requestBonfireGraphQL(query({ fetchImpl }))).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  test('aborted caller does not make any request', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const fetchImpl = mock(async () => { calls++; return ok(); }) as typeof fetch;
    await expect(requestBonfireGraphQL(query({ fetchImpl, signal: controller.signal }))).rejects.toMatchObject({ kind: 'cancelled' });
    expect(calls).toBe(0);
  });

  test('oversized streaming body is rejected before consuming the full stream', async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(1024 * 1024));
        if (pulls === 10) controller.close();
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const fetchImpl = mock(async () => new Response(body, { status: 200 })) as typeof fetch;
    await expect(requestBonfireGraphQL(query({ fetchImpl }))).rejects.toMatchObject({ kind: 'too-large' });
    expect(pulls).toBeLessThan(10);
    expect(cancelled).toBe(true);
  });

  test('error taxonomy does not include remote private messages', () => {
    const err = new BonfireGraphQLError('graphql');
    expect(err.message).toBe('Bonfire GraphQL graphql');
  });
});
