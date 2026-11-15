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
    await expect(fedizenSend('t', 'POST', '/api/v1/statuses')).rejects.toThrow('Unsupported Fedizen write path.');
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
