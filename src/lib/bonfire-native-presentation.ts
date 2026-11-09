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

/** No native network call unless the server has explicitly enabled the
 * rollout gate for a connected, authenticated session. */
export function shouldRequestNativeBonfireHome(
  signedIn: boolean,
  rest: FedizenHome | undefined,
): boolean {
  return signedIn && rest?.connected === true && rest.nativeReadEnabled === true &&
    rest.error !== 'expired';
}

/**
 * Combine only server-verified pages for the same authenticated Fedizen user.
 * Avoid duplicate posts at page boundaries, and fail closed if the linked
 * account or Bonfire identity changes mid-pagination.
 *
 * Never infer authorization from the cursor or a matching display name.
 */
export function mergeNativeBonfirePages(
  rest: FedizenHome,
  pages: readonly NativeBonfireSnapshot[] | undefined,
): NativeBonfireSnapshot | undefined {
  if (!pages?.length) return undefined;
  const first = pages[0];
  if (!first || first.status !== 'available') return first;
  if (!first.identity?.user?.id || first.restAccountHandle === null ||
    !rest.connected || first.restAccountHandle !== rest.accountHandle) {
    return undefined;
  }
  const seen = new Set<string>();
  const combined: NativeBonfireSnapshot['posts'] = [];
  for (const page of pages) {
    if (page.status !== 'available' ||
      page.restAccountHandle !== first.restAccountHandle ||
      page.identity?.user?.id !== first.identity.user.id) {
      return undefined;
    }
    for (const post of page.posts) {
      if (!seen.has(post.id)) {
        seen.add(post.id);
        combined.push(post);
      }
    }
  }
  const last = pages[pages.length - 1];
  return {
    ...first,
    posts: combined,
    homeEndCursor: last.homeEndCursor,
    homeHasNextPage: last.homeHasNextPage,
  };
}

/** Cursor loops or runaway pagination should never trigger more requests. */
export function nextNativeHomeCursor(
  pages: readonly NativeBonfireSnapshot[],
  usedCursors: readonly (string | null)[],
): string | undefined {
  if (pages.length === 0 || pages.length >= 10) return undefined;
  const first = pages[0];
  const last = pages[pages.length - 1];
  if (first?.status !== 'available' || !first.identity?.user?.id ||
    last?.status !== 'available' ||
    last.restAccountHandle !== first.restAccountHandle ||
    last.identity?.user?.id !== first.identity.user.id ||
    !last.homeHasNextPage || !last.homeEndCursor ||
    usedCursors.includes(last.homeEndCursor)) return undefined;
  return last.homeEndCursor;
}
