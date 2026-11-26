import type { FedizenHome } from './fedizen.functions';
import type { NativeBonfireSnapshot } from './bonfire-private.functions';
import { boostFields, type FedizenPost } from './fedizen-feed';

/**
 * The old REST timeline remains the fallback until a server-gated, identity
 * verified Bonfire-native read actually succeeds. No demo content or locally
 * inferred notification categories are introduced.
 */
export function selectBonfireHome(
  rest: FedizenHome,
  native?: NativeBonfireSnapshot,
) {
  const validNative = rest.connected && rest.nativeReadEnabled === true && native?.status === 'available' &&
    native.restAccountHandle !== null &&
    native.restAccountHandle === rest.accountHandle;
  if (validNative) {
    return {
      source: 'native' as const,
      posts: native.posts,
      // Activity stays the REST notifications Home already read: GraphQL notifications carry only a verb and a name,
      // without the faces, post links and wording the column shows.
      notices: rest.notices,
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
    !rest.connected || rest.nativeReadEnabled !== true || first.restAccountHandle !== rest.accountHandle) {
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

/**
 * A server-verified denial during pagination supersedes previously cached
 * rollout readiness. Transient transport/GraphQL failures do not revoke the
 * existing REST connection or erase earlier valid pages.
 *
 * The caller must write the returned status to the same account-scoped REST
 * query that owns nativeReadEnabled, before presenting any cached native page.
 */
export function reconcileNativeContinuationStatus(
  rest: FedizenHome | undefined,
  status: NativeBonfireSnapshot['status'],
): FedizenHome | undefined {
  if (!rest) return rest;
  if (status === 'disconnected') {
    return {
      connected: false,
      accountHandle: null,
      nativeReadEnabled: false,
      posts: [],
      notices: [],
    };
  }
  if (status === 'disabled' || status === 'authorization-required' ||
    status === 'identity-unverified') {
    return { ...rest, nativeReadEnabled: false };
  }
  return rest;
}

/**
 * Home opens on the copy saved on this device and doesn't re-read it (useFedizen), so the server's current
 * native-read switch and connection state are checked separately (getFedizenStatus). A changed switch updates only
 * that field, so posts on screen stay put; a connection the server no longer has means Home must be read again.
 * A different linked account also re-reads, since the cached posts belong to it.
 */
export function reconcileCachedHome(
  cached: FedizenHome | undefined,
  status: { connected: boolean; handle: string | null; nativeReadEnabled?: boolean } | undefined,
): { refetch: boolean; patch?: Pick<FedizenHome, 'nativeReadEnabled'> } {
  if (!cached || !status) return { refetch: false };
  if (cached.connected !== status.connected) return { refetch: true };
  if (!status.connected) return { refetch: false };
  if (status.handle !== null && cached.accountHandle !== null && status.handle !== cached.accountHandle) return { refetch: true };
  const enabled = status.nativeReadEnabled === true;
  return (cached.nativeReadEnabled === true) === enabled ? { refetch: false } : { refetch: false, patch: { nativeReadEnabled: enabled } };
}

/**
 * Native Home with the details read after the first load (getNativeHomeDetails) in place of the GraphQL-only cards
 * they belong to. A card keeps its GraphQL id and booster; one still unread stays as it is.
 */
export function withNativeDetails(
  native: NativeBonfireSnapshot | undefined,
  details: Readonly<Record<string, FedizenPost>> | undefined,
): NativeBonfireSnapshot | undefined {
  if (!native || !details || native.status !== 'available') return native;
  let changed = false;
  const posts = native.posts.map(p => {
    const rest = p.statusRef ? details[p.statusRef] : undefined;
    if (!rest) return p;
    changed = true;
    const { statusRef: _drop, ...card } = rest;
    return {
      ...card,
      id: p.id,
      ...(p.relayed ? { relayed: p.relayed } : boostFields(p.booster, p.boostedBy)),
    };
  });
  return changed ? { ...native, posts } : native;
}

/** Status ids of native Home cards still waiting for their details, at most 20, in feed order. */
export function nativeCardsToRead(native: NativeBonfireSnapshot | undefined): string[] {
  if (!native || native.status !== 'available') return [];
  return [...new Set(native.posts.flatMap(p => (p.statusRef && !p.statusId ? [p.statusRef] : [])))].slice(0, 20);
}

/**
 * Which posts on the newest native page are new to the reader: those above the first one already shown. When none of
 * the newest page is shown yet, everything on it is new and there may be more between (gap). Nothing is new before
 * the reader has a feed.
 */
export function nativeNewPosts(latest: readonly FedizenPost[], shown: readonly FedizenPost[]): { fresh: FedizenPost[]; gap: boolean } {
  if (!shown.length) return { fresh: [], gap: false };
  const known = new Set(shown.map(p => p.id));
  const at = latest.findIndex(p => known.has(p.id));
  if (at === -1) return { fresh: [...latest], gap: latest.length > 0 };
  return { fresh: latest.slice(0, at), gap: false };
}
