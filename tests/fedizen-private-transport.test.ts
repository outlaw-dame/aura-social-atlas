import { afterEach, describe, expect, test } from 'bun:test';
import { fedizenGet, fedizenSend } from '../src/lib/fedizen.server';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe('Fedizen private reads and writes are allowlisted', () => {
  test('refuses reads and writes outside the allowlist before any request', async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response('[]'); }) as unknown as typeof fetch;
    await expect(fedizenGet('t', '/api/v1/accounts/verify_credentials')).rejects.toThrow('Unsupported Fedizen read path.');
    await expect(fedizenGet('t', '/api/v1/conversations?limit=31')).rejects.toThrow('Unsupported Fedizen read path.');
    await expect(fedizenGet('t', '/api/v1/accounts/relationships?id%5B%5D=a/../b')).rejects.toThrow('Unsupported Fedizen read path.');
    // Atlas posts only replies: a body without the post it answers, or with anything else in it, never leaves.
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses')).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses', { status: 'hi', visibility: 'public' })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses', { status: 'hi', in_reply_to_id: '01A', visibility: 'public', media_ids: ['x'] })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses', { status: ' ', in_reply_to_id: '01A', visibility: 'public' })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses/01A/pin')).rejects.toThrow('Unsupported Fedizen write path.');
    await expect(fedizenSend('t', 'POST', '/api/v1-bonfire/groups/a%2F..%2Fx/join')).rejects.toThrow('Unsupported Fedizen write path.');
    await expect(fedizenSend('t', 'DELETE' as 'POST', '/api/v1/accounts/abc/follow')).rejects.toThrow('Unsupported Fedizen write path.');
    expect(called).toBe(false);
  });

  test('reads conversations with redirects disabled and drops answers that do not match the schema', async () => {
    let seen: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seen = init;
      return new Response(JSON.stringify([{ id: '1', unread: true, accounts: [{ acct: 'ana' }], last_status: { id: 's', content: '<p>hi</p>' }, extra: 'dropped' }]));
    }) as unknown as typeof fetch;
    const ok = await fedizenGet('t', '/api/v1/conversations?limit=30');
    expect(ok.status).toBe(200);
    expect((ok.data[0] as Record<string, unknown>).extra).toBeUndefined();
    expect(seen?.redirect).toBe('error');
    expect(seen?.cache).toBe('no-store');
    globalThis.fetch = (async () => new Response('[{"unread":true}]')) as unknown as typeof fetch;
    expect(await fedizenGet('t', '/api/v1/conversations?limit=30')).toEqual({ status: 502, data: [] });
  });
  test('an oversized link preview is dropped field by field, never the whole timeline', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify([
      { id: '1', content: '<p>a</p>', card: { url: 'https://news.org/a', title: 'x'.repeat(600), provider_name: 'News', author_name: 'y'.repeat(300) } },
      { id: '2', content: '<p>b</p>', card: 'not a card' },
    ]))) as unknown as typeof fetch;
    const r = await fedizenGet('t', '/api/v1/timelines/home?limit=20');
    expect(r.status).toBe(200);
    expect(r.data).toHaveLength(2);
    expect((r.data[0] as { card: unknown }).card).toEqual({ url: 'https://news.org/a', title: null, provider_name: 'News', author_name: null });
    expect((r.data[1] as { card: unknown }).card).toBeNull();
  });

  test('joins a group with a bounded, schema-checked reply and never forwards a redirect', async () => {
    let seen: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => { seen = init; return new Response('{"following":true,"group":{"member":true},"token":"x"}'); }) as unknown as typeof fetch;
    const r = await fedizenSend('t', 'POST', '/api/v1-bonfire/groups/01M6H1DWNEPEGAP2GM9QDVS135/join');
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ following: true, group: { member: true } });
    expect(seen?.redirect).toBe('error');
    globalThis.fetch = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
    expect(await fedizenSend('t', 'POST', '/api/v1/accounts/abc/unfollow')).toEqual({ status: 403, data: null });
  });
});

describe('Saved (Bonfire bookmarks) and Circles (Bonfire circles as Mastodon Lists)', () => {
  test('bookmarks, lists, list members and handle lookup are the only new reads', async () => {
    let called = 0;
    globalThis.fetch = (async () => { called++; return new Response('[]'); }) as unknown as typeof fetch;
    await expect(fedizenGet('t', '/api/v1/bookmarks?limit=41')).rejects.toThrow('Unsupported Fedizen read path.');
    await expect(fedizenGet('t', '/api/v1/lists/abc/accounts')).rejects.toThrow('Unsupported Fedizen read path.');
    await expect(fedizenGet('t', '/api/v1/accounts/lookup?acct=a/b')).rejects.toThrow('Unsupported Fedizen read path.');
    expect(called).toBe(0);
    expect((await fedizenGet('t', '/api/v1/bookmarks?limit=40')).status).toBe(200);
    expect((await fedizenGet('t', '/api/v1/lists')).status).toBe(200);
  });

  test('handle lookup answers one account, returned as a one-item list', async () => {
    globalThis.fetch = (async () => new Response('{"id":"01ABC","acct":"ana@lemmy.ca","display_name":"Ana","secret":"x"}')) as unknown as typeof fetch;
    const r = await fedizenGet('t', `/api/v1/accounts/lookup?acct=${encodeURIComponent('ana@lemmy.ca')}`);
    expect(r).toEqual({ status: 200, data: [{ id: '01ABC', acct: 'ana@lemmy.ca', display_name: 'Ana' }] });
  });

  test('each circle write takes only its method and its body', async () => {
    const seen: { method?: string; body?: string }[] = [];
    globalThis.fetch = (async (_u: string, init?: RequestInit) => { seen.push({ method: init?.method, body: init?.body as string }); return new Response('{"id":"01L","title":"Close friends"}'); }) as unknown as typeof fetch;
    expect((await fedizenSend('t', 'POST', '/api/v1/lists', { title: 'Close friends' })).data).toEqual({ id: '01L', title: 'Close friends' });
    await fedizenSend('t', 'POST', '/api/v1/lists/01L/accounts', { account_ids: ['01A'] });
    await fedizenSend('t', 'DELETE', '/api/v1/lists/01L');
    await fedizenSend('t', 'POST', '/api/v1/statuses/01S/bookmark');
    expect(seen.map(s => s.method)).toEqual(['POST', 'POST', 'DELETE', 'POST']);
    expect(seen[1].body).toBe('{"account_ids":["01A"]}');
    expect(seen[2].body).toBeUndefined();
    await expect(fedizenSend('t', 'POST', '/api/v1/lists', { title: 'x', replies_policy: 'list' })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/lists')).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'DELETE', '/api/v1/lists/01L', { title: 'x' })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/lists/01L/accounts', { account_ids: ['../x'] })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'PUT', '/api/v1/statuses/01S/bookmark')).rejects.toThrow('Unsupported Fedizen write path.');
    expect(seen.length).toBe(4);
  });
});

describe('Moderation: blocked people only (Bonfire rc.1 has no client API for keyword filters or instance blocks)', () => {
  test('blocks are read and changed through their own allowlisted routes', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (u: string, init?: RequestInit) => { seen.push(`${init?.method} ${new URL(u).pathname}${new URL(u).search}`); return new Response(init?.method === 'GET' ? '[{"id":"01A","acct":"x@y.z"}]' : '{}'); }) as unknown as typeof fetch;
    expect((await fedizenGet('t', '/api/v1/blocks?limit=80')).data).toEqual([{ id: '01A', acct: 'x@y.z' }]);
    await fedizenSend('t', 'POST', '/api/v1/accounts/01A/block');
    await fedizenSend('t', 'POST', '/api/v1/accounts/01A/unblock');
    expect(seen).toEqual(['GET /api/v1/blocks?limit=80', 'POST /api/v1/accounts/01A/block', 'POST /api/v1/accounts/01A/unblock']);
    await expect(fedizenGet('t', '/api/v1/domain_blocks')).rejects.toThrow('Unsupported Fedizen read path.');
    await expect(fedizenGet('t', '/api/v2/filters')).rejects.toThrow('Unsupported Fedizen read path.');
    await expect(fedizenSend('t', 'POST', '/api/v1/accounts/01A/block', { reason: 'x' })).rejects.toThrow('Unsupported Fedizen write body.');
  });
});

describe('Likes, boosts and replies', () => {
  test('like and boost reach Fedizen, and the answer keeps the flags and counts Atlas shows', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(url.endsWith('/reblog')
        ? { id: 'b1', reblog: { id: '01A', reblogged: true, reblogs_count: 4 }, extra: 'dropped' }
        : { id: '01A', favourited: true, favourites_count: 9 }));
    }) as unknown as typeof fetch;
    const like = await fedizenSend('t', 'POST', '/api/v1/statuses/01A/favourite');
    expect(like.data).toMatchObject({ favourited: true, favourites_count: 9 });
    const boost = await fedizenSend('t', 'POST', '/api/v1/statuses/01A/reblog');
    expect(boost.data?.reblog).toEqual({ reblogged: true, reblogs_count: 4 });
    expect((boost.data as Record<string, unknown>).extra).toBeUndefined();
    await fedizenSend('t', 'POST', '/api/v1/statuses/01A/unfavourite');
    await fedizenSend('t', 'POST', '/api/v1/statuses/01A/unreblog');
    expect(seen.map(s => s.url)).toEqual(['/api/v1/statuses/01A/favourite', '/api/v1/statuses/01A/reblog', '/api/v1/statuses/01A/unfavourite', '/api/v1/statuses/01A/unreblog'].map(p => `https://fedizen.net${p}`));
  });
  test('a reply carries only its text, the post it answers and the audience', async () => {
    let body: unknown;
    globalThis.fetch = (async (_u: string, init?: RequestInit) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id: 'r1', url: 'https://fedizen.net/post/r1' })); }) as unknown as typeof fetch;
    const r = await fedizenSend('t', 'POST', '/api/v1/statuses', { status: '@rosa lovely', in_reply_to_id: '01A', visibility: 'private' });
    expect(r.status).toBe(200);
    expect(body).toEqual({ status: '@rosa lovely', in_reply_to_id: '01A', visibility: 'private' });
    expect(r.data?.url).toBe('https://fedizen.net/post/r1');
  });
  test('a reply may carry a content warning, and nothing else besides', async () => {
    let body: unknown;
    globalThis.fetch = (async (_u: string, init?: RequestInit) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id: 'r2' })); }) as unknown as typeof fetch;
    await fedizenSend('t', 'POST', '/api/v1/statuses', { status: 'agreed', in_reply_to_id: '01A', visibility: 'public', spoiler_text: 'finale spoilers' });
    expect(body).toEqual({ status: 'agreed', in_reply_to_id: '01A', visibility: 'public', spoiler_text: 'finale spoilers' });
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses', { status: 'x', in_reply_to_id: '01A', visibility: 'public', spoiler_text: 'w', sensitive: true })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses', { status: 'x', in_reply_to_id: '01A', visibility: 'public', spoiler_text: 'w'.repeat(501) })).rejects.toThrow('Unsupported Fedizen write body.');
  });
});
