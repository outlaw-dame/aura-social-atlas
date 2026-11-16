import { describe, expect, test } from 'bun:test';
import { requestBonfireGraphQL, BonfireGraphQLError } from '../src/lib/bonfire-graphql.server';
import { FEDIZEN_USER_AGENT, transportDetail } from '../src/lib/fedizen-http';

describe('requests to Fedizen (lib/fedizen-http)', () => {
  test('GraphQL names Atlas in User-Agent (Workers send none; DreamHost’s firewall refuses those)', async () => {
    let ua = '';
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      ua = (init.headers as Record<string, string>)['user-agent'];
      return new Response(JSON.stringify({ data: { ok: true } }));
    }) as unknown as typeof fetch;
    await requestBonfireGraphQL({ operation: 'query', document: '{ok}', fetchImpl, validate: v => v });
    expect(ua).toBe(FEDIZEN_USER_AGENT);
    expect(ua).toMatch(/^Atlas\//);
  });
  test('a network failure says what the runtime said, never the token', async () => {
    const fetchImpl = (async () => { throw new TypeError('Network connection lost. Bearer abc.def', { cause: new Error('ECONNRESET') }); }) as unknown as typeof fetch;
    const e = await requestBonfireGraphQL({ operation: 'mutation', document: 'mutation{x}', fetchImpl, validate: v => v }).catch(x => x);
    expect(e).toBeInstanceOf(BonfireGraphQLError);
    expect(e.kind).toBe('network');
    expect(e.detail).toBe('TypeError: Network connection lost. Bearer … ← Error: ECONNRESET');
  });
  test('transportDetail of a non-error', () => expect(transportDetail('x')).toBe('unknown'));
});
