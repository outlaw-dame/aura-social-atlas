import { describe, expect, test, mock } from 'bun:test';
import { connectionFor, parseFedizenAccount, parseFedizenReadGrant, verifyFedizenReadGrant } from '../src/lib/fedizen.server';

describe('Fedizen delegated OAuth grant acceptance', () => {
  test('accepts a valid requested read scope and token without exposing it', () => {
    expect(parseFedizenReadGrant({ access_token: 'opaque-secret', scope: 'read' }))
      .toEqual({ access_token: 'opaque-secret', scope: 'read' });
    expect(parseFedizenReadGrant({ access_token: 'opaque-secret' }))
      .toEqual({ access_token: 'opaque-secret', scope: 'read' });
  });
  test.each([
    null, [], {}, { access_token: '' }, { access_token: 42 },
    { access_token: 'secret\r\nheader' }, { access_token: 'x'.repeat(8193) },
    { access_token: 'opaque', scope: 'write' },
    { access_token: 'opaque', scope: 'read:accounts write' },
    { access_token: 'opaque', scope: 42 },
  ])('rejects malformed or insufficient token grants %#', value => {
    expect(parseFedizenReadGrant(value)).toBeNull();
  });
  test('requires a nonempty verified account identity', () => {
    expect(parseFedizenAccount({ id: '123', acct: 'alice@fedizen.net' })).toBe('alice@fedizen.net');
    for (const invalid of [{ acct: 'alice' }, { id: 'a' }, { id: '', acct: 'alice' },
      { id: '1', acct: '' }, { id: 2, acct: 'alice' }, { id: '1', acct: 'bad\nvalue' }, null]) {
      expect(parseFedizenAccount(invalid)).toBeNull();
    }
  });
  test('verifies consented grant using only the fixed origin and no redirects', async () => {
    const fetcher = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://fedizen.net/api/v1/accounts/verify_credentials');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret');
      expect(init?.redirect).toBe('error');
      expect(init?.cache).toBe('no-store');
      return new Response(JSON.stringify({ id: '123', acct: 'alice' }), { status: 200 });
    }) as typeof fetch;
    expect(await verifyFedizenReadGrant('secret', fetcher)).toBe('alice');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  test('401 and invalid account responses cannot be stored as verified accounts', async () => {
    expect(await verifyFedizenReadGrant('secret', mock(async () => new Response('no', { status: 401 })) as typeof fetch)).toBeNull();
    expect(await verifyFedizenReadGrant('secret', mock(async () => new Response('{"acct":"alice"}', { status: 200 })) as typeof fetch)).toBeNull();
    expect(await verifyFedizenReadGrant('secret', mock(async () => { throw Error('sensitive upstream message'); }) as typeof fetch)).toBeNull();
  });
  test('declared oversize cancels the account response stream', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const fetcher = mock(async () => new Response(body, { headers: { 'content-length': '20000' } })) as typeof fetch;
    expect(await verifyFedizenReadGrant('secret', fetcher)).toBeNull();
    expect(cancelled).toBe(true);
  });
  test('chunked oversize cancels without reading an unbounded response', async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(8192)); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const fetcher = mock(async () => new Response(body)) as typeof fetch;
    expect(await verifyFedizenReadGrant('secret', fetcher)).toBeNull();
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(6);
  });
});

describe('Fedizen per-account connection DB read failures', () => {
  function dbFor(records: Record<string, unknown>, dbError = false) {
    let selected = '';
    const conditions = new Map<string, string>();
    const builder = {
      select(columns: string) { selected = columns; return builder; },
      eq(key: string, value: string) { conditions.set(key, value); return builder; },
      async maybeSingle() {
        expect(selected).toBe('access_token, account_handle');
        expect(conditions.get('user_id')).toBeDefined();
        return dbError ? { data: null, error: { code: 'DB_DOWN' } } :
          { data: records[conditions.get('user_id')! ] ?? null, error: null };
      },
    };
    return { from(name: string) { expect(name).toBe('fedizen_connections'); return builder; } } as unknown as Parameters<typeof connectionFor>[0];
  }
  test('lookup is scoped by caller identity and does not reveal other users tokens', async () => {
    const db = dbFor({
      alice: { access_token: 'alice-secret', account_handle: 'alice' },
      bob: { access_token: 'bob-secret', account_handle: 'bob' },
    });
    expect(await connectionFor(db, 'alice')).toMatchObject({ access_token: 'alice-secret' });
    expect(await connectionFor(db, 'bob')).toMatchObject({ access_token: 'bob-secret' });
    expect(await connectionFor(db, 'mallory')).toBeNull();
  });
  test('DB failure is not misrepresented as a disconnected account', async () => {
    await expect(connectionFor(dbFor({}, true), 'alice')).rejects.toThrow('Could not read Fedizen connection.');
  });
});
