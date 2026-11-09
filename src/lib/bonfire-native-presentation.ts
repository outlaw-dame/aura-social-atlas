import type { FedizenHome } from './fedizen.functions';
import type { NativeBonfireSnapshot } from './bonfire-private.functions';

/**
 * The old REST timeline remains the fallback until a server-gated, identity
 * verified Bonfire-native read actually succeeds. No demo content or locally
 * inferred notification categories are introduced.
 */
export function selectBonfireHome(
  rest: FedizenHome,
  native?: NativeBonfireSnapshot,
) {
  const validNative = rest.connected && native?.status === 'available' &&
    native.restAccountHandle !== null &&
    native.restAccountHandle === rest.accountHandle;
  if (validNative) {
    return {
      source: 'native' as const,
      posts: native.posts,
      notices: native.notices.map(n => ({
        id: n.id,
        type: 'activity',
        author: n.actor,
        date: n.date,
        avatar: undefined,
        text: n.verb,
      })),
      profile: native.identity?.user ?? null,
      hasNextPage: native.homeHasNextPage,
      endCursor: native.homeEndCursor,
    };
  }
  return {
    source: 'rest' as const,
    posts: rest.posts,
    notices: rest.notices,
    profile: null,
    hasNextPage: false,
    endCursor: null,
  };
}
