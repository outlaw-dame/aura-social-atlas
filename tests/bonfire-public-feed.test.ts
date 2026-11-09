import { afterEach, describe, expect, test, mock } from 'bun:test';
import { fetchPublicFeed, fetchRecentArticles } from '../src/lib/bonfire.server';

const originalFetch = globalThis.fetch;
const originalError = console.error;

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalError;
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stub(body: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response(body, status);
  }) as typeof fetch;
  console.error = () => {};
  return calls;
}

describe('Bonfire anonymous public GraphQL reads', () => {
  test('local query uses fixed endpoint and returns genuine empty feed', async () => {
    const calls = stub({ data: { feedActivities: { edges: [] } } });
    expect(await fetchPublicFeed()).toEqual({ posts: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://fedizen.net/api/graphql');
    const init = calls[0]?.init;
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    expect(init?.cache).toBe('no-store');
    expect(JSON.parse(String(init?.body)).query).toContain('feedName:"local"');
    expect(init?.headers).not.toHaveProperty('authorization');
  });

  test('articles query shares transport without reporting an empty response as failure', async () => {
    const calls = stub({ data: { feedActivities: { edges: [] } } });
    expect(await fetchRecentArticles()).toEqual({ articles: [] });
    expect(JSON.parse(String(calls[0]?.init?.body)).query).toContain('feedName:"articles"');
  });

  test('HTTP 200 with GraphQL errors cannot be treated as a complete feed', async () => {
    const calls = stub({ data: { feedActivities: { edges: [] } }, errors: [{ message: 'sensitive' }] });
    expect(await fetchPublicFeed()).toEqual({ posts: [], error: 'unavailable' });
    expect(calls).toHaveLength(1);
  });

  test.each([
    { data: null },
    { data: { feedActivities: null } },
    { data: { feedActivities: { edges: 'wrong' } } },
    { data: { feedActivities: { edges: [{ node: null }] } } },
    { data: { feedActivities: { edges: [{ node: { id: 42 } }] } } },
  ])('rejects invalid GraphQL envelope or edges %#', async payload => {
    stub(payload);
    expect(await fetchRecentArticles()).toEqual({ articles: [], error: 'unavailable' });
  });

  test('transient HTTP 503 returns unavailable after bounded safe retries', async () => {
    const calls = stub({ errors: [] }, 503);
    expect(await fetchPublicFeed()).toEqual({ posts: [], error: 'unavailable' });
    expect(calls).toHaveLength(3);
  });

  test('network exceptions return unavailable after bounded safe retries', async () => {
    let calls = 0;
    console.error = () => {};
    globalThis.fetch = mock(async () => { calls++; throw new Error('connection failed with secret'); }) as typeof fetch;
    expect(await fetchPublicFeed()).toEqual({ posts: [], error: 'unavailable' });
    expect(calls).toBe(3);
  });
});
