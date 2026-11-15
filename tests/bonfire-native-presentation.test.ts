import { describe, expect, test } from 'bun:test';
import { mergeNativeBonfirePages, nextNativeHomeCursor, reconcileNativeContinuationStatus, selectBonfireHome, shouldRequestNativeBonfireHome } from '../src/lib/bonfire-native-presentation';
import type { FedizenHome } from '../src/lib/fedizen.functions';
import type { NativeBonfireSnapshot } from '../src/lib/bonfire-private.functions';

const rest: FedizenHome = {
  connected: true,
  accountHandle: 'alice',
  nativeReadEnabled: true,
  posts: [{ id: 'rest-1', author: 'REST author', handle: '@rest', paragraphs: ['existing'], url: 'https://fedizen.net/1' }],
  notices: [{ id: 'rest-notice', type: 'mention', author: 'REST actor', text: 'mentioned you' }],
};

const native: NativeBonfireSnapshot = {
  status: 'available',
  identity: { accountId: 'identity-1', user: {
    id: 'bonfire-user',
    character: { username: 'alice', canonicalUri: 'https://fedizen.net/users/alice' },
    profile: { name: 'Alice', icon: null },
  } },
  restAccountHandle: 'alice',
  posts: [{ id: 'native-1', author: 'Bonfire author', handle: '@bonfire', paragraphs: ['native'], url: 'https://fedizen.net/2' }],
  notices: [{ id: 'native-notice', verb: 'Like', actor: 'Native actor' }],
  homeEndCursor: 'cursor',
  homeHasNextPage: true,
  notificationEndCursor: null,
  notificationHasNextPage: false,
};

describe('Atlas native Bonfire presentation gate', () => {
  test('uses genuine Bonfire content only after server confirms account identity', () => {
    const view = selectBonfireHome(rest, native);
    expect(view.source).toBe('native');
    expect(view.posts.map(p => p.id)).toEqual(['native-1']);
    expect(view.notices).toMatchObject([{ id: 'native-notice', author: 'Native actor', text: 'Like', type: 'activity' }]);
    expect(view.endCursor).toBe('cursor');
    expect(view.hasNextPage).toBe(true);
    expect(view.profile?.character?.username).toBe('alice');
  });

  test('a mismatched linked account cannot replace the REST content', () => {
    const view = selectBonfireHome(rest, { ...native, restAccountHandle: 'someone-else' });
    expect(view.source).toBe('rest');
    expect(view.posts).toEqual(rest.posts);
    expect(view.notices).toEqual(rest.notices);
    expect(view.profile).toBeNull();
  });

  test('native data never appears for a disconnected Atlas account', () => {
    const view = selectBonfireHome({ ...rest, connected: false }, native);
    expect(view.source).toBe('rest');
    expect(view.posts).toEqual(rest.posts);
  });

  test('disabled, denied, unavailable or incomplete native reads cannot silently replace REST', () => {
    for (const status of ['disabled', 'disconnected', 'authorization-required', 'identity-unverified', 'unavailable'] as const) {
      const view = selectBonfireHome(rest, { ...native, status });
      expect(view.source).toBe('rest');
      expect(view.posts).toEqual(rest.posts);
    }
    expect(selectBonfireHome(rest).posts).toEqual(rest.posts);
    expect(selectBonfireHome({ ...rest, nativeReadEnabled: false }, native).source).toBe('rest');
  });

  test('native entry does not override REST if linked handle is missing', () => {
    expect(selectBonfireHome(rest, { ...native, restAccountHandle: null }).source).toBe('rest');
    expect(selectBonfireHome({ ...rest, accountHandle: null }, native).source).toBe('rest');
  });
});

describe('Native GraphQL rollout avoids unnecessary authenticated requests', () => {
  test('default, disconnected, expired, and unsigned-in states never query native', () => {
    expect(shouldRequestNativeBonfireHome(true, { ...rest, nativeReadEnabled: undefined })).toBe(false);
    expect(shouldRequestNativeBonfireHome(true, undefined)).toBe(false);
    expect(shouldRequestNativeBonfireHome(false, { ...rest, nativeReadEnabled: true })).toBe(false);
    expect(shouldRequestNativeBonfireHome(true, { ...rest, connected: false, nativeReadEnabled: true })).toBe(false);
    expect(shouldRequestNativeBonfireHome(true, { ...rest, nativeReadEnabled: true, error: 'expired' })).toBe(false);
    expect(shouldRequestNativeBonfireHome(true, { ...rest, nativeReadEnabled: false })).toBe(false);
  });

  test('an explicitly operator-enabled authenticated connection may query native', () => {
    expect(shouldRequestNativeBonfireHome(true, { ...rest, nativeReadEnabled: true })).toBe(true);
  });
});

describe('Native Home cursor and account-scoped pagination', () => {
  const next = (id: string, after: string | null, more: boolean): NativeBonfireSnapshot => ({
    ...native,
    posts: [{ ...native.posts[0], id }],
    notices: [],
    homeEndCursor: after,
    homeHasNextPage: more,
  });

  test('appends distinct posts in page order, deduplicates overlaps and keeps first-page notifications', () => {
    const second = { ...next('native-2', 'cursor-2', true), posts: [
      native.posts[0],
      { ...native.posts[0], id: 'native-2' },
    ] };
    const result = mergeNativeBonfirePages(rest, [native, second]);
    expect(result?.posts.map(p => p.id)).toEqual(['native-1', 'native-2']);
    expect(result?.notices).toEqual(native.notices);
    expect(result?.homeEndCursor).toBe('cursor-2');
    expect(nextNativeHomeCursor([native, second], [null, 'cursor'])).toBe('cursor-2');
  });

  test('does not serve a page if the user, REST handle, or session connection changed', () => {
    const other = next('other', null, false);
    expect(mergeNativeBonfirePages(rest, [native, { ...other, restAccountHandle: 'bob' }])).toBeUndefined();
    expect(mergeNativeBonfirePages(rest, [native, {
      ...other, identity: { ...native.identity!, user: { ...native.identity!.user!, id: 'different-user' } },
    }])).toBeUndefined();
    expect(mergeNativeBonfirePages({ ...rest, accountHandle: 'bob' }, [native])).toBeUndefined();
    expect(mergeNativeBonfirePages({ ...rest, connected: false }, [native])).toBeUndefined();
    expect(mergeNativeBonfirePages({ ...rest, nativeReadEnabled: false }, [native])).toBeUndefined();
    expect(mergeNativeBonfirePages(rest, [native, { ...other, status: 'authorization-required' }])).toBeUndefined();
  });

  test('stops at the end, on repeated cursors, and after the bounded page limit', () => {
    expect(nextNativeHomeCursor([next('last', null, false)], [null])).toBeUndefined();
    expect(nextNativeHomeCursor([next('broken', null, true)], [null])).toBeUndefined();
    expect(nextNativeHomeCursor([native], [null, 'cursor'])).toBeUndefined();
    expect(nextNativeHomeCursor([native, { ...next('n2', 'cursor-2', true), restAccountHandle: 'other' }], [null, 'cursor'])).toBeUndefined();
    expect(nextNativeHomeCursor(Array.from({ length: 10 }, (_, i) => next(String(i), 'next-cursor', true)),
      [null, 'a','b','c','d','e','f','g','h','i'])).toBeUndefined();
  });

  test('refuses pages that share a handle but resolve to another Bonfire actor', () => {
    const changed = { ...next('other', 'next', true),
      identity: { ...native.identity!, user: { ...native.identity!.user!, id: 'different-user' } },
    };
    expect(nextNativeHomeCursor([native, changed], [null, 'cursor'])).toBeUndefined();
  });

  test('missing and disabled initial native reads remain REST-only', () => {
    expect(mergeNativeBonfirePages(rest, [])).toBeUndefined();
    expect(selectBonfireHome(rest, mergeNativeBonfirePages(rest, [])).source).toBe('rest');
    expect(mergeNativeBonfirePages(rest, [{ ...native, status: 'disabled' }])?.status).toBe('disabled');
    expect(selectBonfireHome(rest,
      mergeNativeBonfirePages(rest, [{ ...native, status: 'disabled' }])).source).toBe('rest');
  });
});

describe('Revoked server-side native visibility invalidates cached presentation', () => {
  test('operator disables native during continuation: old cached native posts disappear', () => {
    const revoked = reconcileNativeContinuationStatus(rest, 'disabled')!;
    expect(revoked.nativeReadEnabled).toBe(false);
    expect(selectBonfireHome(revoked, native).source).toBe('rest');
    expect(mergeNativeBonfirePages(revoked, [native])).toBeUndefined();
    expect(shouldRequestNativeBonfireHome(true, revoked)).toBe(false);
  });

  test('identity denial and explicit disconnection cannot preserve private native pages', () => {
    for (const status of ['authorization-required', 'identity-unverified'] as const) {
      const denied = reconcileNativeContinuationStatus(rest, status)!;
      expect(selectBonfireHome(denied, native).source).toBe('rest');
      expect(shouldRequestNativeBonfireHome(true, denied)).toBe(false);
    }
    const disconnected = reconcileNativeContinuationStatus(rest, 'disconnected')!;
    expect(disconnected.connected).toBe(false);
    expect(disconnected.accountHandle).toBeNull();
    expect(disconnected.posts).toEqual([]);
    expect(disconnected.notices).toEqual([]);
    expect(selectBonfireHome(disconnected, native).source).toBe('rest');
  });

  test('transient upstream failure cannot silently disconnect a real REST account', () => {
    expect(reconcileNativeContinuationStatus(rest, 'unavailable')).toBe(rest);
    expect(reconcileNativeContinuationStatus(rest, 'available')).toBe(rest);
    expect(reconcileNativeContinuationStatus(undefined, 'disabled')).toBeUndefined();
  });
});
