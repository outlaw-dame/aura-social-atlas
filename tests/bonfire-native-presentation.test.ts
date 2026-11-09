import { describe, expect, test } from 'bun:test';
import { selectBonfireHome } from '../src/lib/bonfire-native-presentation';
import type { FedizenHome } from '../src/lib/fedizen.functions';
import type { NativeBonfireSnapshot } from '../src/lib/bonfire-private.functions';

const rest: FedizenHome = {
  connected: true,
  accountHandle: 'alice',
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
  });

  test('native entry does not override REST if linked handle is missing', () => {
    expect(selectBonfireHome(rest, { ...native, restAccountHandle: null }).source).toBe('rest');
    expect(selectBonfireHome({ ...rest, accountHandle: null }, native).source).toBe('rest');
  });
});
