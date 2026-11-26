import { readKeptFeed, writeKeptFeed, type KeptFeed } from '@/lib/kept-feeds';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQueries, useQuery, type InfiniteData } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getCircleFeed, getFedizenHome, getFedizenLocal, getFedizenTagFeed, getFollowedTags, getForYou, type ForYouCursors } from '@/lib/fedizen.functions';
import { useOlderPages } from './useOlderPages';
import type { NativeBonfireSnapshot } from '@/lib/bonfire-private.functions';
import { mergeNativeBonfirePages, selectBonfireHome } from '@/lib/bonfire-native-presentation';
import { getFedizenPublic, getRecentArticles } from '@/lib/bonfire.functions';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { followedTagsIn } from '@/lib/hashtags';
import { BASE_FEEDS, circleFeed, hasNew, markFeedSeen, newestOf, useFeedsSeen, usePinnedCircles, type FeedKind, type ForYouReason } from '@/lib/feed-types';
import { useAtlasAuth } from './AuthState';

/** For You, read through the person's Fedizen connection. */
export function useForYou(enabled: boolean) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getForYou);
  const id = user?.id;
  // Opens on this device's copy (kept-feeds.ts), read again from Fedizen at once.
  const kept = useMemo(() => (id && typeof window !== 'undefined' ? readKeptFeed<Awaited<ReturnType<typeof read>>>(id, 'foryou') : null), [id]);
  const q = useQuery({
    queryKey: ['fedizen-foryou', id],
    queryFn: () => { if (!id) throw new Error('Atlas user is not signed in.'); return read({ data: { expectedAtlasUserId: id } }); },
    enabled: !!id && enabled, staleTime: 60_000,
    ...(kept ? { initialData: kept.data, initialDataUpdatedAt: kept.savedAt } : {}),
  });
  useKeep(id, 'foryou', q.data);
  return q;
}

/** Keeps a feed's first page on this device once it came back whole (not a copy read back, not an error). */
function useKeep(id: string | undefined, feed: KeptFeed, data: { error?: unknown; kept?: true; posts?: unknown[] } | undefined) {
  useEffect(() => {
    if (!id || !data || data.error || data.kept || !data.posts?.length) return;
    const t = setTimeout(() => writeKeptFeed(id, feed, data), 800);
    return () => clearTimeout(t);
  }, [id, feed, data]);
}

/** The hashtags the person follows (lowercase), as a set for marking posts. Empty when signed out or not connected. */
export function useFollowedTags(): ReadonlySet<string> {
  const { user } = useAtlasAuth();
  const read = useServerFn(getFollowedTags);
  const id = user?.id;
  const q = useQuery({
    queryKey: ['fedizen-followed-tags', id],
    queryFn: () => read({ data: { expectedAtlasUserId: id! } }),
    enabled: !!id, staleTime: q => (q.state.data?.error ? 0 : 5 * 60_000),
    select: d => new Set(d.tags),
  });
  return q.data ?? EMPTY_TAGS;
}
const EMPTY_TAGS: ReadonlySet<string> = new Set();
const NO_VARIANTS: Readonly<Record<string, string>> = {};

/** Other spellings Atlas follows behind a followed hashtag (spelling → the hashtag followed: #ps5pro → ps5). */
export function useTagVariants(): Readonly<Record<string, string>> {
  const { user } = useAtlasAuth();
  const read = useServerFn(getFollowedTags);
  const id = user?.id;
  const q = useQuery({
    queryKey: ['fedizen-followed-tags', id],
    queryFn: () => read({ data: { expectedAtlasUserId: id! } }),
    enabled: !!id, staleTime: q => (q.state.data?.error ? 0 : 5 * 60_000),
    select: d => d.variants ?? NO_VARIANTS,
  });
  return q.data ?? NO_VARIANTS;
}

/**
 * The hashtags a card names in its tag line: those its text uses that you follow (an other spelling of one reads as
 * the one you follow), the hashtag whose FediBuzz relay brought it in, and any For You found it by.
 */
export function tagLineFor(p: Pick<FedizenPost, 'paragraphs' | 'relayed'>, followed: ReadonlySet<string>, variants: Readonly<Record<string, string>>, reasons?: ForYouReason[]): string[] {
  const watched = Object.keys(variants).length ? new Set([...followed, ...Object.keys(variants)]) : followed;
  const inText = followedTagsIn(p.paragraphs, watched).map(t => variants[t] ?? t);
  const relayed = p.relayed?.kind === 'tag' ? [variants[p.relayed.value] ?? p.relayed.value] : [];
  const fromReasons = (reasons ?? []).flatMap(r => (r.kind === 'tag' ? [r.tag.toLowerCase()] : []));
  return [...new Set([...inText, ...relayed, ...fromReasons])];
}
export function useTagLine(p: Pick<FedizenPost, 'paragraphs' | 'relayed'>, reasons?: ForYouReason[]): string[] {
  return tagLineFor(p, useFollowedTags(), useTagVariants(), reasons);
}

/** A hashtag's feed through the person's Fedizen connection (only posts they may see). */
export function useTagFeed(tag: string | null) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getFedizenTagFeed);
  const id = user?.id;
  return useQuery({
    queryKey: ['fedizen-tag-feed', id, tag],
    queryFn: () => read({ data: { expectedAtlasUserId: id!, tag: tag! } }),
    // A feed is fresh for a minute; a failure isn't, so reopening the tag (or remounting) asks Fedizen again.
    enabled: !!id && !!tag, staleTime: q => (q.state.data?.error ? 0 : 60_000),
  });
}

/** A pinned circle's feed. */
export function useCircleFeed(circleId: string | null) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getCircleFeed);
  const id = user?.id;
  return useQuery({
    queryKey: ['fedizen-circle-feed', id, circleId],
    queryFn: () => { if (!id || !circleId) throw new Error('Nothing to read.'); return read({ data: { expectedAtlasUserId: id, id: circleId } }); },
    enabled: !!id && !!circleId, staleTime: 60_000,
  });
}

export const FEED_PROBLEM = {
  'not-connected': 'Connect your Fedizen account to see this feed.',
  'needs-permission': 'Reconnect Fedizen so Atlas can read this feed.',
  expired: 'Fedizen ended Atlas’s access. Connect again to keep reading.',
  unavailable: 'Fedizen couldn’t send this feed right now.',
  'not-found': 'This circle no longer exists on Fedizen.',
} as const;

const onVisibility = (l: () => void) => { document.addEventListener('visibilitychange', l); return () => document.removeEventListener('visibilitychange', l); };

export type FeedTab = { id: FeedKind; label: string; hint?: string; circle?: boolean; isNew: boolean };

/**
 * The Feeds tabs — Following, For You, Articles, Local, then pinned circles — each with a dot when it has posts newer
 * than the person last saw there (as Particle marks its topics). Every feed is read through the same queries its view
 * uses, so the dots cost no extra requests once a view has loaded, and the open feed counts as seen as it updates.
 */
/**
 * `active` is null until the view has restored the feed it was on, so the default tab isn't counted as seen.
 * `nativeFollowing`: Following shows Bonfire's native home when that read is verified (desktop does, via
 * selectBonfireHome); its dot then follows the same posts. It only observes the native query, never starts it.
 */
export function useFeedTabs(active: FeedKind | null, { nativeFollowing = false }: { nativeFollowing?: boolean } = {}): FeedTab[] {
  const { user } = useAtlasAuth();
  const uid = user?.id;
  const home = useServerFn(getFedizenHome), circle = useServerFn(getCircleFeed);
  const pinned = usePinnedCircles(uid);
  const seen = useFeedsSeen(uid);
  const following = useQuery({
    queryKey: ['fedizen-home', uid],
    queryFn: () => { if (!uid) throw new Error('Atlas user is not signed in.'); return home({ data: { expectedAtlasUserId: uid } }); },
    enabled: !!uid, staleTime: 60_000,
  });
  const native = useQuery<InfiniteData<NativeBonfireSnapshot>>({ queryKey: ['bonfire-native-home', uid], enabled: false });
  const followingPosts = following.data
    ? (nativeFollowing ? selectBonfireHome(following.data, mergeNativeBonfirePages(following.data, native.data?.pages)).posts : following.data.posts)
    : undefined;
  const forYou = useForYou(!!uid);
  const articles = useQuery({ queryKey: ['bonfire-articles'], queryFn: () => getRecentArticles(), staleTime: 5 * 60_000 });
  const local = useQuery({ queryKey: ['fedizen-public'], queryFn: () => getFedizenPublic(), staleTime: 60_000 });
  // Connected, Local shows Fedizen's local timeline read through the person's account (useLocalFeed): its dot follows
  // that. This only observes the query the view starts.
  const localMine = useQuery<{ posts: FedizenPost[]; error?: unknown }>({ queryKey: ['fedizen-local', uid], enabled: false });
  const localPosts = localMine.data && !localMine.data.error ? localMine.data.posts : local.data?.posts;
  const circles = useQueries({ queries: pinned.map(c => ({
    queryKey: ['fedizen-circle-feed', uid, c.id],
    queryFn: () => { if (!uid) throw new Error('Nothing to read.'); return circle({ data: { expectedAtlasUserId: uid, id: c.id } }); },
    enabled: !!uid, staleTime: 60_000,
  })) });
  const newest: Record<string, string | undefined> = {
    following: newestOf(followingPosts), foryou: newestOf(forYou.data?.posts),
    articles: newestOf(articles.data?.articles), local: newestOf(localPosts),
    ...Object.fromEntries(pinned.map((c, i) => [circleFeed(c.id), newestOf(circles[i]?.data?.posts)])),
  };
  const key = JSON.stringify(newest);
  // A feed in a background browser tab isn't being read either.
  const pageVisible = useSyncExternalStore(onVisibility, () => document.visibilityState === 'visible', () => false);
  const reading = pageVisible ? active : null;
  useEffect(() => {
    if (!uid) return;
    for (const [feed, n] of Object.entries(newest)) if (n && ((reading && feed === reading) || !seen[feed])) markFeedSeen(uid, feed as FeedKind, n);
  }, [uid, reading, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [
    ...BASE_FEEDS.map(f => ({ ...f, isNew: !!uid && f.id !== active && hasNew(seen[f.id], newest[f.id]) })),
    ...pinned.map(c => ({ id: circleFeed(c.id), label: c.title, circle: true, isNew: !!uid && circleFeed(c.id) !== active && hasNew(seen[circleFeed(c.id)], newest[circleFeed(c.id)]) })),
  ];
}

/* ── Older pages, below each feed's first ─────────────────────────────────────────────────────── */

/** For You further down: the next pages of Home and of the followed hashtags it drew from. */
export function useForYouOlder(d: { posts: FedizenPost[]; next?: ForYouCursors; error?: unknown } | undefined) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getForYou);
  const id = user?.id;
  return useOlderPages(['fedizen-foryou', id], d?.posts ?? EMPTY, d?.next, (older: ForYouCursors) => read({ data: { expectedAtlasUserId: id!, older } }), !!id && !!d && !d.error && !(d as { kept?: true }).kept);
}

/** A hashtag's feed further down. */
export function useTagFeedOlder(tag: string | null, d: { posts: FedizenPost[]; next?: string; error?: unknown } | undefined) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getFedizenTagFeed);
  const id = user?.id;
  return useOlderPages(['fedizen-tag-feed', id, tag], d?.posts ?? EMPTY, d?.next, (max: string) => read({ data: { expectedAtlasUserId: id!, tag: tag!, max } }), !!id && !!tag && !!d && !d.error);
}

/** A pinned circle's feed further down. */
export function useCircleFeedOlder(circleId: string | null, d: { posts: FedizenPost[]; next?: string; error?: unknown } | undefined) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getCircleFeed);
  const id = user?.id;
  return useOlderPages(['fedizen-circle-feed', id, circleId], d?.posts ?? EMPTY, d?.next, (max: string) => read({ data: { expectedAtlasUserId: id!, id: circleId!, max } }), !!id && !!circleId && !!d && !d.error);
}

/**
 * Local as the person reads it through their Fedizen connection (each post can be acted on), with older pages. Signed
 * out or not connected (`error`), views show the public feed instead.
 */
export function useLocalFeed() {
  const { user } = useAtlasAuth();
  const read = useServerFn(getFedizenLocal);
  const id = user?.id;
  const kept = useMemo(() => (id && typeof window !== 'undefined' ? readKeptFeed<Awaited<ReturnType<typeof read>>>(id, 'local') : null), [id]);
  const q = useQuery({
    queryKey: ['fedizen-local', id],
    queryFn: () => read({ data: { expectedAtlasUserId: id! } }),
    enabled: !!id, staleTime: q => (q.state.data?.error ? 0 : 60_000),
    ...(kept ? { initialData: kept.data, initialDataUpdatedAt: kept.savedAt } : {}),
  });
  useKeep(id, 'local', q.data);
  const older = useOlderPages(['fedizen-local', id], q.data?.posts ?? EMPTY, q.data?.next, (max: string) => read({ data: { expectedAtlasUserId: id!, max } }), !!id && !!q.data && !q.data.error && !(q.data as { kept?: true }).kept);
  return { q, older, connected: !!id && !!q.data && !q.data.error };
}
const EMPTY: FedizenPost[] = [];
