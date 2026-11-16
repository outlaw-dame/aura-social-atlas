import { describe, expect, test } from 'bun:test';
import { QUOTE_POST_DOCUMENT } from '../src/lib/bonfire/graphql/operations';
import { requestBonfireGraphQL } from '../src/lib/bonfire-graphql.server';

describe('quote posts (Bonfire createPost with quoteId)', () => {
  test('the mutation names Bonfire’s arguments in the schema’s camelCase', () => {
    for (const arg of ['createPost(', 'postContent: $postContent', 'boundary: $boundary', 'quoteId: $quoteId', 'uploadedMedia: $uploadedMedia', 'canonicalUri'])
      expect(QUOTE_POST_DOCUMENT).toContain(arg);
  });
  test('sent once (a mutation is never retried), with the token, and its answer validated', async () => {
    let calls = 0, sent: any, auth = '';
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      calls++; sent = JSON.parse(String(init.body)); auth = (init.headers as Record<string, string>).authorization;
      return new Response(JSON.stringify({ data: { createPost: { id: '01Q', activity: { canonicalUri: 'https://fedizen.net/post/01Q' } } } }));
    }) as unknown as typeof fetch;
    const r = await requestBonfireGraphQL({
      operation: 'mutation', document: QUOTE_POST_DOCUMENT, accessToken: 'tok', fetchImpl,
      variables: { postContent: { htmlBody: 'So good' }, boundary: 'public', quoteId: '01A' },
      validate: v => (v as { createPost: { id: string } }).createPost,
    });
    expect(r.id).toBe('01Q');
    expect(calls).toBe(1);
    expect(auth).toBe('Bearer tok');
    expect(sent.variables).toEqual({ postContent: { htmlBody: 'So good' }, boundary: 'public', quoteId: '01A' });
  });
});
