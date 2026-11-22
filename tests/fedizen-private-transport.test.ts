import { afterEach, describe, expect, test } from 'bun:test';
import { fedizenGet, fedizenSend, fedizenUpload } from '../src/lib/fedizen.server';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe('Fedizen private reads and writes are allowlisted', () => {
  test('refuses reads and writes outside the allowlist before any request', async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response('[]'); }) as unknown as typeof fetch;
    await expect(fedizenGet('t', '/api/v1/accounts/verify_credentials')).rejects.toThrow('Unsupported Fedizen read path.');
    await expect(fedizenGet('t', '/api/v1/conversations?limit=31')).rejects.toThrow('Unsupported Fedizen read path.');
    await expect(fedizenGet('t', '/api/v1/accounts/relationships?id%5B%5D=a/../b')).rejects.toThrow('Unsupported Fedizen read path.');
    // A post's body is checked: nothing beyond its known fields, and never empty.
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses')).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses', { status: 'hi', visibility: 'public', poll: {} })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses', { status: 'hi', in_reply_to_id: '01A', visibility: 'public', scheduled_at: '2030-01-01' })).rejects.toThrow('Unsupported Fedizen write body.');
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
    expect(seen?.redirect).toBe('manual');
    expect(seen?.cache).toBe('no-store');
    globalThis.fetch = (async () => new Response('[{"unread":true}]')) as unknown as typeof fetch;
    expect(await fedizenGet('t', '/api/v1/conversations?limit=30')).toEqual({ status: 502, data: [], failure: 'mismatch' });
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
    expect(seen?.redirect).toBe('manual');
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

describe('posting with media', () => {
  test('a new post may carry up to 4 media ids, marked sensitive; never empty, never sensitive without media', async () => {
    const bodies: unknown[] = [];
    globalThis.fetch = (async (_u: string, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ id: 'p1', url: 'https://fedizen.net/post/p1' })); }) as unknown as typeof fetch;
    await fedizenSend('t', 'POST', '/api/v1/statuses', { status: 'hi', visibility: 'public' });
    await fedizenSend('t', 'POST', '/api/v1/statuses', { status: '', visibility: 'private', media_ids: ['m1', 'm2'], sensitive: true, spoiler_text: 'cw' });
    expect(bodies[1]).toEqual({ status: '', visibility: 'private', media_ids: ['m1', 'm2'], sensitive: true, spoiler_text: 'cw' });
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses', { status: ' ', visibility: 'public' })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses', { status: 'x', visibility: 'public', sensitive: true })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses', { status: 'x', visibility: 'public', media_ids: ['1', '2', '3', '4', '5'] })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses', { status: 'x', visibility: 'public', media_ids: ['../x'] })).rejects.toThrow('Unsupported Fedizen write body.');
  });
  test('an upload goes to /api/v2/media as multipart with its alt text, and answers the media id', async () => {
    let seen: { url: string; form: FormData | null } = { url: '', form: null };
    globalThis.fetch = (async (u: string, init?: RequestInit) => { seen = { url: u, form: init?.body as FormData }; return new Response(JSON.stringify({ id: 'M1', type: 'image', preview_url: 'https://fedizen.net/m/1.jpg' })); }) as unknown as typeof fetch;
    const r = await fedizenUpload('t', new Blob([new Uint8Array(10)], { type: 'image/jpeg' }), 'my photo.jpg', 'A cat on a wall', 5_000_000);
    expect(r).toEqual({ status: 200, id: 'M1', preview: 'https://fedizen.net/m/1.jpg' });
    expect(seen.url).toBe('https://fedizen.net/api/v2/media');
    expect(seen.form?.get('description')).toBe('A cat on a wall');
    expect((seen.form?.get('file') as File).name).toBe('my_photo.jpg');
  });
  test('uploads outside the types Fedizen stores, or over the limit, never leave', async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch;
    await expect(fedizenUpload('t', new Blob(['x'], { type: 'image/svg+xml' }), 'a.svg', '', 5_000_000)).rejects.toThrow('Unsupported Fedizen upload type.');
    await expect(fedizenUpload('t', new Blob(['x'], { type: 'application/pdf' }), 'a.pdf', '', 5_000_000)).rejects.toThrow('Unsupported Fedizen upload type.');
    await expect(fedizenUpload('t', new Blob([new Uint8Array(11)], { type: 'image/png' }), 'a.png', '', 10)).rejects.toThrow('Unsupported Fedizen upload size.');
    expect(called).toBe(false);
  });
  test('the instance limits are an allowed read', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ configuration: { statuses: { max_characters: 500000 }, media_attachments: { image_size_limit: 8000000, video_size_limit: 40000000 } } }))) as unknown as typeof fetch;
    const r = await fedizenGet('t', '/api/v2/instance');
    expect(r.data[0]).toMatchObject({ configuration: { media_attachments: { image_size_limit: 8000000 } } });
  });
});

describe('Own posts, polls, follow requests and search: allowlisted', () => {
  test('accepts exactly these paths and bodies', async () => {
    const seen: [string, string | undefined, string | null][] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => { seen.push([String(url), init?.method, (init?.body as string) ?? null]); return new Response('{}'); }) as unknown as typeof fetch;
    await fedizenSend('t', 'DELETE', '/api/v1/statuses/01ABC');
    await fedizenSend('t', 'PUT', '/api/v1/statuses/01ABC', { status: 'fixed typo', spoiler_text: '' });
    await fedizenSend('t', 'POST', '/api/v1/follow_requests/01ABC/authorize');
    await fedizenSend('t', 'POST', '/api/v1/follow_requests/01ABC/reject');
    await fedizenSend('t', 'POST', '/api/v1/polls/01ABC/votes', { choices: [0, 2] });
    await fedizenSend('t', 'POST', '/api/v1/statuses', { status: 'Which?', visibility: 'public', poll: { options: ['a', 'b'], expires_in: 86400, multiple: false } });
    expect(seen.map(s => `${s[1]} ${s[0].replace('https://fedizen.net', '')}`)).toEqual([
      'DELETE /api/v1/statuses/01ABC', 'PUT /api/v1/statuses/01ABC', 'POST /api/v1/follow_requests/01ABC/authorize',
      'POST /api/v1/follow_requests/01ABC/reject', 'POST /api/v1/polls/01ABC/votes', 'POST /api/v1/statuses',
    ]);
  });
  test('refuses what they mustn’t carry', async () => {
    globalThis.fetch = (async () => new Response('{}')) as unknown as typeof fetch;
    await expect(fedizenSend('t', 'PUT', '/api/v1/statuses/01ABC', { status: '', spoiler_text: '' })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'PUT', '/api/v1/statuses/01ABC', { status: 'x', spoiler_text: '', media_ids: ['1'] })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses', { status: 'x', visibility: 'public', media_ids: ['01A'], poll: { options: ['a', 'b'], expires_in: 3600, multiple: false } })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses', { status: 'x', visibility: 'public', poll: { options: ['a'], expires_in: 3600, multiple: false } })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses', { status: 'x', visibility: 'public', poll: { options: ['a', 'b'], expires_in: 60, multiple: false } })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/polls/01ABC/votes', { choices: [] })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'DELETE', '/api/v1/statuses/../accounts')).rejects.toThrow('Unsupported Fedizen write path.');
    await expect(fedizenGet('t', '/api/v2/search?q=x&type=accounts&limit=20')).rejects.toThrow('Unsupported Fedizen read path.');
  });
  test('reads follow requests, a post’s source, a poll and post search', async () => {
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes('follow_requests')) return new Response(JSON.stringify([{ id: '01P', acct: 'ana@lemmy.ca', display_name: 'Ana', url: 'https://lemmy.ca/u/ana' }]));
      if (u.endsWith('/source')) return new Response(JSON.stringify({ id: '01S', text: '<p>Hello</p>', spoiler_text: '' }));
      if (u.includes('/polls/')) return new Response(JSON.stringify({ id: '01Q', expired: false, multiple: false, votes_count: 3, voted: true, own_votes: [1], options: [{ title: 'a', votes_count: 1 }, { title: 'b', votes_count: 2 }] }));
      return new Response(JSON.stringify({ accounts: [], statuses: [{ id: '01T', content: '<p>atlas</p>' }], hashtags: [] }));
    }) as unknown as typeof fetch;
    expect((await fedizenGet('t', '/api/v1/follow_requests?limit=40')).data).toHaveLength(1);
    expect((await fedizenGet('t', '/api/v1/statuses/01S/source')).data[0]).toMatchObject({ text: '<p>Hello</p>' });
    expect((await fedizenGet('t', '/api/v1/polls/01Q')).data[0]).toMatchObject({ voted: true, own_votes: [1] });
    expect(((await fedizenGet('t', `/api/v2/search?q=${encodeURIComponent('atlas app')}&type=statuses&limit=20`)).data[0] as { statuses: unknown[] }).statuses).toHaveLength(1);
  });
});

describe('A post’s conversation: allowlisted', () => {
  test('reads ancestors and descendants, dropping any one post that does not fit', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      ancestors: [{ id: '01A', content: '<p>up</p>' }],
      descendants: [{ id: '01B', content: '<p>reply</p>', in_reply_to_id: '01T' }, { content: 'no id' }, 'junk'],
    }))) as unknown as typeof fetch;
    const r = await fedizenGet('t', '/api/v1/statuses/01T/context');
    expect(r.status).toBe(200);
    const ctx = r.data[0] as { ancestors: { id: string }[]; descendants: { id: string }[] };
    expect(ctx.ancestors.map(s => s.id)).toEqual(['01A']);
    expect(ctx.descendants.map(s => s.id)).toEqual(['01B']);
    await expect(fedizenGet('t', '/api/v1/statuses/01T/context?limit=5')).rejects.toThrow('Unsupported Fedizen read path.');
    await expect(fedizenGet('t', '/api/v1/statuses/../context')).rejects.toThrow('Unsupported Fedizen read path.');
  });
});

describe('Mute, report, who reacted, liked posts and hashtag search: allowlisted', () => {
  test('mute and report take only their paths and bodies', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => { seen.push(`${init?.method} ${String(url).replace('https://fedizen.net', '')}`); return new Response('{}'); }) as unknown as typeof fetch;
    await fedizenSend('t', 'POST', '/api/v1/accounts/01ABC/mute');
    await fedizenSend('t', 'POST', '/api/v1/accounts/01ABC/unmute');
    await fedizenSend('t', 'POST', '/api/v1/reports', { account_id: '01ABC', status_ids: ['01S'], comment: '', category: 'spam', forward: false });
    expect(seen).toEqual(['POST /api/v1/accounts/01ABC/mute', 'POST /api/v1/accounts/01ABC/unmute', 'POST /api/v1/reports']);
    await expect(fedizenSend('t', 'POST', '/api/v1/reports', { account_id: '01ABC', comment: '', category: 'nonsense', forward: false })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/reports', { account_id: '01ABC', comment: '', category: 'spam', forward: false, rule_ids: ['1'] })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/reports', { account_id: '01ABC', comment: 'x'.repeat(1001), category: 'other', forward: false })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/accounts/01ABC/mute', { duration: 60 })).rejects.toThrow('Unsupported Fedizen write body.');
  });
  test('reads mutes, liked posts, who liked or boosted, and hashtag search', async () => {
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes('/mutes') || u.includes('favourited_by') || u.includes('reblogged_by')) return new Response(JSON.stringify([{ id: '01P', acct: 'ana@lemmy.ca', display_name: 'Ana', url: 'https://lemmy.ca/u/ana' }]));
      if (u.includes('/favourites')) return new Response(JSON.stringify([{ id: '01T', content: '<p>liked</p>' }]));
      return new Response(JSON.stringify({ accounts: [], statuses: [], hashtags: [{ name: 'atlas', url: 'https://fedizen.net/tags/atlas' }] }));
    }) as unknown as typeof fetch;
    expect((await fedizenGet('t', '/api/v1/mutes?limit=80')).data).toHaveLength(1);
    expect((await fedizenGet('t', '/api/v1/favourites?limit=40')).data).toHaveLength(1);
    expect((await fedizenGet('t', '/api/v1/statuses/01T/favourited_by?limit=40')).data).toHaveLength(1);
    expect((await fedizenGet('t', '/api/v1/statuses/01T/reblogged_by?limit=40')).data).toHaveLength(1);
    expect(((await fedizenGet('t', '/api/v2/search?q=atl&type=hashtags&limit=8')).data[0] as { hashtags: { name: string }[] }).hashtags[0].name).toBe('atlas');
    await expect(fedizenGet('t', '/api/v1/statuses/01T/favourited_by?limit=500')).rejects.toThrow('Unsupported Fedizen read path.');
    await expect(fedizenGet('t', '/api/v2/search?q=atl&type=hashtags&limit=8&resolve=true')).rejects.toThrow('Unsupported Fedizen read path.');
  });
});

describe('Your recent posts, for the hashtags you used: allowlisted', () => {
  test('reads only your own posts without boosts, 40 at a time', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify([{ id: '01T', content: '<p>#atlas</p>', tags: [{ name: 'atlas' }] }]))) as unknown as typeof fetch;
    expect((await fedizenGet('t', '/api/v1/accounts/01ABC/statuses?limit=40&exclude_reblogs=true')).data).toHaveLength(1);
    await expect(fedizenGet('t', '/api/v1/accounts/01ABC/statuses?limit=40')).rejects.toThrow('Unsupported Fedizen read path.');
    await expect(fedizenGet('t', '/api/v1/accounts/01ABC/statuses?limit=80&exclude_reblogs=true')).rejects.toThrow('Unsupported Fedizen read path.');
  });
});

describe('Push subscription writes: only to an Atlas relay', () => {
  const keys = { p256dh: 'B'.padEnd(87, 'A'), auth: 'A'.repeat(22) };
  const data = { alerts: { mention: true, status: false, reblog: true, follow: true, follow_request: true, favourite: true, poll: true, update: false, quote: true }, policy: 'all' };
  test('subscribes, updates and unsubscribes with exactly these bodies', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => { seen.push(`${init?.method} ${String(url).replace('https://fedizen.net', '')}`); return new Response(JSON.stringify({ id: '1', server_key: 'B'.padEnd(87, 'x') })); }) as unknown as typeof fetch;
    const r = await fedizenSend('t', 'POST', '/api/v1/push/subscription', { subscription: { endpoint: 'https://atlas-social.space/api/push/relay/' + 'a'.repeat(32), keys }, data });
    expect(r.data?.server_key).toBe('B'.padEnd(87, 'x'));
    await fedizenSend('t', 'PUT', '/api/v1/push/subscription', { data: { ...data, policy: 'followed' } });
    await fedizenSend('t', 'DELETE', '/api/v1/push/subscription');
    expect(seen).toEqual(['POST /api/v1/push/subscription', 'PUT /api/v1/push/subscription', 'DELETE /api/v1/push/subscription']);
  });
  test('never to anywhere but a relay, and no extra alerts or fields', async () => {
    globalThis.fetch = (async () => new Response('{}')) as unknown as typeof fetch;
    await expect(fedizenSend('t', 'POST', '/api/v1/push/subscription', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys }, data })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/push/subscription', { subscription: { endpoint: 'http://atlas-social.space/api/push/relay/' + 'a'.repeat(32), keys }, data })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'PUT', '/api/v1/push/subscription', { data: { ...data, alerts: { ...data.alerts, admin_sign_up: true } } })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'PUT', '/api/v1/push/subscription', { data: { ...data, policy: 'everyone' } })).rejects.toThrow('Unsupported Fedizen write body.');
  });
});

describe('Grouped notifications: allowlisted', () => {
  test('reads v2 notifications, mentions only, and older pages; nothing else', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ accounts: [{ id: 'a', acct: 'ann' }], statuses: [], notification_groups: [{ group_key: 'page-1', notifications_count: 2, type: 'favourite', sample_account_ids: ['a'] }] }))) as unknown as typeof fetch;
    expect(((await fedizenGet('t', '/api/v2/notifications?limit=40')).data[0] as { notification_groups: unknown[] }).notification_groups).toHaveLength(1);
    await fedizenGet('t', '/api/v2/notifications?limit=40&types%5B%5D=mention');
    await fedizenGet('t', '/api/v2/notifications?limit=40&types%5B%5D=mention&max_id=g3QAAAAB');
    await expect(fedizenGet('t', '/api/v2/notifications?limit=80')).rejects.toThrow('Unsupported Fedizen read path.');
    await expect(fedizenGet('t', '/api/v2/notifications?limit=40&types%5B%5D=favourite')).rejects.toThrow('Unsupported Fedizen read path.');
  });
});

describe('Activity: tab filters, the notifications marker and Follow back', () => {
  test('grouped notifications take only the tabs’ types; the marker reads and writes notifications only', async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch;
    await expect(fedizenGet('t', '/api/v2/notifications?limit=40&types%5B%5D=admin.report')).rejects.toThrow('Unsupported Fedizen read path.');
    await expect(fedizenGet('t', '/api/v1/markers?timeline%5B%5D=home')).rejects.toThrow('Unsupported Fedizen read path.');
    await expect(fedizenSend('t', 'POST', '/api/v1/markers', { home: { last_read_id: '1' } })).rejects.toThrow('Unsupported Fedizen write body.');
    await expect(fedizenSend('t', 'POST', '/api/v1/markers', { notifications: { last_read_id: '../x' } })).rejects.toThrow('Unsupported Fedizen write body.');
    expect(called).toBe(false);
  });
  test('reads a tab’s grouped notifications with each group’s newest id, and the marker', async () => {
    globalThis.fetch = (async (url: string) => new Response(JSON.stringify(String(url).includes('markers')
      ? { notifications: { last_read_id: '01JB', updated_at: '2026-11-18T00:00:00Z', extra: 1 } }
      : { accounts: [], statuses: [{ id: 's', content: '<p>x</p>', in_reply_to_id: 'p', in_reply_to_account_id: 'me' }], notification_groups: [{ group_key: 'g', type: 'mention', most_recent_notification_id: '01JC', status_id: 's' }] }))) as unknown as typeof fetch;
    const g = await fedizenGet('t', '/api/v2/notifications?limit=40&types%5B%5D=mention&types%5B%5D=status&types%5B%5D=quote');
    const page = g.data[0] as { notification_groups: { most_recent_notification_id: string }[]; statuses: { in_reply_to_account_id: string }[] };
    expect(page.notification_groups[0].most_recent_notification_id).toBe('01JC');
    expect(page.statuses[0].in_reply_to_account_id).toBe('me');
    const m = await fedizenGet('t', '/api/v1/markers?timeline%5B%5D=notifications');
    expect(m.data[0]).toEqual({ notifications: { last_read_id: '01JB', updated_at: '2026-11-18T00:00:00Z' } });
    const w = await fedizenSend('t', 'POST', '/api/v1/markers', { notifications: { last_read_id: '01JC' } });
    expect(w.status).toBe(200);
  });
});
