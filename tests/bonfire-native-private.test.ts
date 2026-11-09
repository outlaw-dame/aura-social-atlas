import { describe, expect, mock, test } from 'bun:test';
import {
  NATIVE_HOME_DOCUMENT, NATIVE_ME_DOCUMENT, NATIVE_NOTIFICATIONS_DOCUMENT,
  publicFeedDocument, validatedBonfireNodes,
} from '../src/lib/bonfire/graphql/operations';
import {
  readNativeBonfireMe, readNativeBonfirePage, validateNativeBonfirePage,
  normalizeNativeBonfireHome, normalizeNativeBonfireNotifications, matchesLinkedFedizenHandle,
} from '../src/lib/bonfire-private.server';
import { nativeBonfireReadEnabled } from '../src/lib/bonfire-private.functions';

const response = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status });
const pageInfo = {
  endCursor: 'cursor-next', startCursor: 'cursor-first',
  hasNextPage: true, hasPreviousPage: false,
};
const authUser = {
  accountId: 'bonfire-account-1',
  user: {
    id: 'bonfire-user-1',
    character: { username: 'testaccount', canonicalUri: 'https://fedizen.net/@testaccount' },
    profile: { name: 'Test Account', icon: 'https://fedizen.net/avatar.png' },
  },
};

describe('deployed schema-verified Bonfire native read operations', () => {
  test('only the explicit verified operator flag can enable native GraphQL reads', () => {
    expect(nativeBonfireReadEnabled(undefined)).toBe(false);
    expect(nativeBonfireReadEnabled('true')).toBe(false);
    expect(nativeBonfireReadEnabled('enabled')).toBe(false);
    expect(nativeBonfireReadEnabled('verified')).toBe(true);
  });

  test('keeps static GraphQL documents and shares public Activity selection', () => {
    expect(NATIVE_ME_DOCUMENT).toContain('accountId user { id character');
    expect(NATIVE_HOME_DOCUMENT).toContain('myFeed(first:$first, after:$after)');
    expect(NATIVE_NOTIFICATIONS_DOCUMENT).toContain('notifications(first:$first, after:$after)');
    expect(publicFeedDocument('local')).toContain('feedName:"local"');
    expect(publicFeedDocument('articles')).toContain('feedName:"articles"');
    expect(NATIVE_HOME_DOCUMENT).toContain('objectPostContent{name summary htmlBody}');
    expect(NATIVE_NOTIFICATIONS_DOCUMENT).toContain('pageInfo { endCursor hasNextPage');
    expect(NATIVE_ME_DOCUMENT).not.toMatch(/mutation/i);
  });

  test('keeps independently verified REST and native account identity consistent', () => {
    expect(matchesLinkedFedizenHandle('testaccount', 'testaccount')).toBe(true);
    expect(matchesLinkedFedizenHandle('testaccount@fedizen.net', '@testaccount')).toBe(true);
    expect(matchesLinkedFedizenHandle('@testaccount@fedizen.net', 'TESTACCOUNT')).toBe(true);
    expect(matchesLinkedFedizenHandle('testaccount@evil.example', 'testaccount')).toBe(false);
    expect(matchesLinkedFedizenHandle('testaccount@fedizen.net.evil.example', 'testaccount')).toBe(false);
    expect(matchesLinkedFedizenHandle('testaccount', 'different')).toBe(false);
    expect(matchesLinkedFedizenHandle(null, 'testaccount')).toBe(false);
    expect(matchesLinkedFedizenHandle('testaccount', null)).toBe(false);
    expect(matchesLinkedFedizenHandle('testaccount/path', 'testaccount')).toBe(false);
    expect(matchesLinkedFedizenHandle('test account', 'test account')).toBe(false);
  });

  test('native Me uses only server-injected bearer at fixed Fedizen origin', async () => {
    let calls = 0;
    const fetchImpl = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      expect(String(url)).toBe('https://fedizen.net/api/graphql');
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('error');
      expect(init?.cache).toBe('no-store');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer consented-fixture-token');
      const body = JSON.parse(String(init?.body));
      expect(body.query).toContain('me { accountId user');
      return response({ data: { me: authUser } });
    }) as typeof fetch;
    expect(await readNativeBonfireMe('consented-fixture-token', { fetchImpl })).toMatchObject(authUser);
    expect(calls).toBe(1);
  });

  test('anonymous/no-account Me response is not a fictional identity', async () => {
    const fetchImpl = mock(async () => response({ data: { me: null } })) as typeof fetch;
    expect(await readNativeBonfireMe('test-token', { fetchImpl })).toBeNull();
  });

  test('a GraphQL error cannot be treated as accepted identity', async () => {
    let calls = 0;
    const fetchImpl = mock(async () => {
      calls++;
      return response({ data: { me: authUser }, errors: [{ message: 'sensitive' }] });
    }) as typeof fetch;
    await expect(readNativeBonfireMe('test-token', { fetchImpl }))
      .rejects.toMatchObject({ kind: 'graphql' });
    expect(calls).toBe(1);
  });

  test('native Home sends bounded cursor variable and validates server pageInfo', async () => {
    const fetchImpl = mock(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.variables).toEqual({ first: 20, after: 'opaque-cursor' });
      expect(body.query).toContain('query AtlasNativeHome');
      return response({ data: {
        me: { myFeed: {
          edges: [{ cursor: 'c0', node: { id: 'post-1', objectPostContent: {
            name: 'Hi', htmlBody: '<p>Visible post</p>',
          } } }],
          pageInfo,
        } },
      } });
    }) as typeof fetch;
    const result = await readNativeBonfirePage('test-token', 'myFeed', 'opaque-cursor', { fetchImpl });
    expect(result?.nodes).toHaveLength(1);
    expect(result?.pageInfo).toEqual(pageInfo);
    const output = normalizeNativeBonfireHome(result!);
    expect(output.posts).toHaveLength(1);
    expect(output.posts[0].id).toBe('post-1');
  });

  test('notifications are separately requested and retain actual Activity verbs', async () => {
    const fetchImpl = mock(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).query).toContain('query AtlasNativeNotifications');
      return response({ data: { me: { notifications: {
        edges: [{ node: { id: 'notice-1', verb: { verb: 'Like' },
          subject: { profile: { name: 'Friend' } } } }],
        pageInfo: { ...pageInfo, hasNextPage: false },
      } } } });
    }) as typeof fetch;
    const result = await readNativeBonfirePage('test-token', 'notifications', null, { fetchImpl });
    expect(normalizeNativeBonfireNotifications(result!).notices)
      .toEqual([{ id: 'notice-1', verb: 'Like', actor: 'Friend', date: undefined }]);
  });

  test('missing native owner feed is unavailable, never a fake empty Home', () => {
    expect(() => validateNativeBonfirePage({ me: {} }, 'myFeed')).toThrow();
    expect(() => validateNativeBonfirePage({ me: { myFeed: null } }, 'myFeed')).toThrow();
    expect(validateNativeBonfirePage({ me: null }, 'myFeed')).toBeNull();
  });

  test('malformed edges, partial pages and invalid cursors are rejected', async () => {
    expect(() => validatedBonfireNodes([null])).toThrow();
    expect(() => validatedBonfireNodes([{ node: { id: 42 } }])).toThrow();
    expect(() => validatedBonfireNodes(Array.from({ length: 21 }, (_, i) =>
      ({ node: { id: String(i) } })))).toThrow();
    expect(() => validateNativeBonfirePage({
      me: { myFeed: { edges: [], pageInfo: { hasNextPage: 'yes' } } },
    }, 'myFeed')).toThrow();
    let calls = 0;
    const fetchImpl = mock(async () => { calls++; return response({ data: {} }); }) as typeof fetch;
    await expect(readNativeBonfirePage('token', 'myFeed', 'bad\nheader', { fetchImpl })).rejects.toThrow('cursor');
    expect(calls).toBe(0);
  });

  test('private 401 is not retried and cannot masquerade as an empty page', async () => {
    let calls = 0;
    const fetchImpl = mock(async () => { calls++; return response({}, 401); }) as typeof fetch;
    await expect(readNativeBonfirePage('token', 'myFeed', null, { fetchImpl }))
      .rejects.toMatchObject({ kind: 'http', status: 401 });
    expect(calls).toBe(1);
  });
});
