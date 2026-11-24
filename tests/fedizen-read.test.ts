import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fedizenReadError } from '../src/lib/fedizen-feed';
import { fedizenGet } from '../src/lib/fedizen.server';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('Fedizen read-side failure isolation', () => {
  test.each([
    [200, 200, undefined],
    [401, 200, 'expired'],
    [200, 401, 'expired'],
    [503, 200, 'unavailable'],
    [200, 403, 'unavailable'],
    [200, 502, 'unavailable'],
    [401, 502, 'expired'],
  ] as const)('combined statuses %i and %i => %s', (home, notes, expected) => {
    expect(fedizenReadError(home, notes)).toBe(expected);
  });

  test('only fixed read paths are accepted before bearer use', async () => {
    let called = false;
    globalThis.fetch = mock(async () => { called = true; return new Response('[]'); }) as typeof fetch;
    await expect(fedizenGet('test-secret', 'https://untrusted.invalid/api/v1/notifications')).rejects.toThrow('Unsupported Fedizen read path.');
    await expect(fedizenGet('test-secret', '/api/v1/notifications?limit=999')).rejects.toThrow('Unsupported Fedizen read path.');
    await expect(fedizenGet('test-secret', '/api/v1/notifications?limit=20#fragment')).rejects.toThrow('Unsupported Fedizen read path.');
    expect(called).toBe(false);
  });

  test('fixed-origin successful request yields only array data', async () => {
    const urls: string[] = [];
    globalThis.fetch = mock(async (url, init) => {
      urls.push(String(url));
      expect(init?.redirect).toBe('manual');
      expect(init?.cache).toBe('no-store');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer sentinel');
      return new Response('[{"id":"item-1"}]', { status: 200 });
    }) as typeof fetch;
    expect(await fedizenGet('sentinel', '/api/v1/timelines/home?limit=20')).toEqual({ status: 200, data: [{ id: 'item-1' }] });
    expect(urls).toEqual(['https://fedizen.net/api/v1/timelines/home?limit=20']);
  });

  test('keeps what opens profiles in Atlas: mentions and the actor', async () => {
    // As fedizen.net's /api/v1/timelines answer (Bonfire's Mastodon API).
    const body = [{ id: 'o1', in_reply_to_id: '01PARENT', content: '<p>@<span>nedley</span> hi</p>',
      account: { acct: 'ai6yr@m.ai6yr.org', username: 'ai6yr', url: 'https://m.ai6yr.org/users/ai6yr', uri: 'https://m.ai6yr.org/users/ai6yr' },
      mentions: [{ acct: 'nedley@mastodon.social', username: 'nedley@mastodon.social', url: 'https://fedizen.net/@nedley@mastodon.social', id: 'x' }] }];
    globalThis.fetch = mock(async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
    const r = await fedizenGet('sentinel', '/api/v1/timelines/home?limit=20');
    const s = r.data[0] as { mentions?: unknown; account?: { url?: string; uri?: string } };
    expect(s.mentions).toEqual([{ acct: 'nedley@mastodon.social', username: 'nedley@mastodon.social' }]);
    expect(s.account?.url).toBe('https://m.ai6yr.org/users/ai6yr');
    expect(s.account?.uri).toBe('https://m.ai6yr.org/users/ai6yr');
    expect((s as { in_reply_to_id?: string }).in_reply_to_id).toBe('01PARENT');
  });

  test('rejects object-shaped HTTP 200 payload as upstream failure', async () => {
    globalThis.fetch = mock(async () => new Response('{"error":"secret"}', { status: 200 })) as typeof fetch;
    expect(await fedizenGet('sentinel', '/api/v1/notifications?limit=20')).toMatchObject({ status: 502, data: [], failure: 'mismatch' });
  });

  test('HTTP 401 retains authorization failure status', async () => {
    globalThis.fetch = mock(async () => new Response('unauthorized', { status: 401 })) as typeof fetch;
    expect(await fedizenGet('sentinel', '/api/v1/notifications?limit=20')).toEqual({ status: 401, data: [], failure: 'refused' });
  });

  test('network exception fails without replaying the request', async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => { calls++; throw new Error('secret in transport exception'); }) as typeof fetch;
    expect(await fedizenGet('sentinel', '/api/v1/notifications?limit=20')).toEqual({ status: 503, data: [], failure: 'unreachable' });
    expect(calls).toBe(1);
  });
  test('valid Home response preserves the fields used by the UI', async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify([{
      id: 'post-1',
      content: '<p>Hello</p>',
      account: { acct: 'writer@fedizen.net', display_name: 'Writer', avatar: 'https://fedizen.net/a.png' },
      media_attachments: [{ type: 'image', preview_url: 'https://fedizen.net/media.png' }],
      reblog: null,
      unexpected_sensitive_field: 'must-not-return',
    }]))) as typeof fetch;
    const result = await fedizenGet('sentinel', '/api/v1/timelines/home?limit=20');
    expect(result.status).toBe(200);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 'post-1', content: '<p>Hello</p>' });
    expect(result.data[0]).not.toHaveProperty('unexpected_sensitive_field');
  });

  test('valid notification and status fields survive read projection', async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify([{
      id: 'notification-1', type: 'mention',
      account: { acct: 'friend' },
      status: { id: 'post-2', content: '<p>Hi</p>' },
    }]))) as typeof fetch;
    const result = await fedizenGet('sentinel', '/api/v1/notifications?limit=20');
    expect(result).toMatchObject({ status: 200 });
    expect(result.data[0]).toMatchObject({ id: 'notification-1', status: { id: 'post-2' } });
  });

  test('rejects malformed personal Home content instead of crashing normalizers', async () => {
    const invalid: unknown[] = [
      null,
      [null],
      [{ id: 12 }],
      [{ id: 'post-1', media_attachments: [null] }],
      [{ id: 'post-1', account: 'not-an-account' }],
      [{ id: 'post-1', reblog: { id: 'x', media_attachments: [null] } }],
      Array.from({ length: 21 }, (_, i) => ({ id: String(i) })),
    ];
    for (const payload of invalid) {
      globalThis.fetch = mock(async () => new Response(JSON.stringify(payload))) as typeof fetch;
      expect(await fedizenGet('sentinel', '/api/v1/timelines/home?limit=20')).toMatchObject({ status: 502, data: [], failure: 'mismatch' });
    }
  });

  test('rejects malformed notification status nested objects', async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify([{ id: 'n', status: { id: 'p', account: [null] } }]))) as typeof fetch;
    expect(await fedizenGet('sentinel', '/api/v1/notifications?limit=20')).toMatchObject({ status: 502, data: [], failure: 'mismatch' });
  });

  test('declared private response oversize cancels the response stream', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    globalThis.fetch = mock(async () => new Response(body, { headers: { 'content-length': '3000000' } })) as typeof fetch;
    expect(await fedizenGet('sentinel', '/api/v1/notifications?limit=20')).toEqual({ status: 502, data: [], failure: 'unreadable' });
    expect(cancelled).toBe(true);
  });

  test('streamed private response cannot exceed the byte cap', async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    globalThis.fetch = mock(async () => new Response(body)) as typeof fetch;
    expect(await fedizenGet('sentinel', '/api/v1/timelines/home?limit=20')).toEqual({ status: 502, data: [], failure: 'unreadable' });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(6);
  });

});

describe('Follow requests: Bonfire sends every pending one', () => {
  const acct = (n: number) => ({ id: `01J${String(n).padStart(23, '0')}`, display_name: `P${n}`, acct: `p${n}@example.social` });
  test('more than 80 are read, and an entry Atlas cannot read is left out instead of failing the list', async () => {
    const list = [...Array.from({ length: 120 }, (_, i) => acct(i)), { display_name: 'no id' }];
    globalThis.fetch = mock(async () => new Response(JSON.stringify(list), { status: 200 })) as typeof fetch;
    const r = await fedizenGet('sentinel', '/api/v1/follow_requests?limit=40');
    expect(r.status).toBe(200);
    expect(r.data).toHaveLength(120);
  });
  test('an answer that is not a list says where it differed, without values', async () => {
    globalThis.fetch = mock(async () => new Response('{"error":"secret"}', { status: 200 })) as typeof fetch;
    const r = await fedizenGet('sentinel', '/api/v1/follow_requests?limit=40');
    expect(r).toMatchObject({ status: 502, failure: 'mismatch', issues: [{ at: '', code: 'invalid_type' }] });
    expect(JSON.stringify(r)).not.toContain('secret');
  });
});

describe('Blocked and muted people: Bonfire sends the whole list whatever limit asks', () => {
  const acct = (n: number) => ({ id: `01K${String(n).padStart(23, '0')}`, display_name: `P${n}`, acct: `p${n}@example.social` });
  for (const route of ['/api/v1/blocks?limit=80', '/api/v1/mutes?limit=80']) {
    test(`${route}: more than 80 are read (seen live), and an unreadable entry is left out`, async () => {
      const list = [...Array.from({ length: 150 }, (_, i) => acct(i)), { display_name: 'no id' }];
      globalThis.fetch = mock(async () => new Response(JSON.stringify(list), { status: 200 })) as typeof fetch;
      const r = await fedizenGet('sentinel', route);
      expect(r.status).toBe(200);
      expect(r.data).toHaveLength(150);
    });
    test(`${route}: Spotlight must not silently drop a blocked/muted actor`, async () => {
      const malformed = [...Array.from({ length: 150 }, (_, i) => acct(i)), { display_name: 'unknown identity' }];
      globalThis.fetch = mock(async () => new Response(JSON.stringify(malformed), { status: 200 })) as typeof fetch;
      const result = await fedizenGet('sentinel', route, { requireCompleteModeration: true });
      expect(result.status).toBe(502);
      expect(result.failure).toBe('mismatch');
      expect(result.data).toEqual([]);
    });
    test(`${route}: strict Spotlight cursor pages reject malformed entries`, async () => {
      const page = `${route}&max_id=older-1`;
      globalThis.fetch = mock(async () => new Response(JSON.stringify([acct(1), { display_name: 'missing id' }]), { status: 200 })) as typeof fetch;
      const strict = await fedizenGet('sentinel', page, { requireCompleteModeration: true });
      expect(strict.status).toBe(502);
      const userFacing = await fedizenGet('sentinel', page);
      expect(userFacing.status).toBe(200);
      expect(userFacing.data).toHaveLength(1);
    });
    test(`${route}: Spotlight accepts a complete large moderation list`, async () => {
      const complete = Array.from({ length: 150 }, (_, i) => acct(i));
      globalThis.fetch = mock(async () => new Response(JSON.stringify(complete), { status: 200 })) as typeof fetch;
      const result = await fedizenGet('sentinel', route, { requireCompleteModeration: true });
      expect(result.status).toBe(200);
      expect(result.data).toHaveLength(150);
    });
  }
});
