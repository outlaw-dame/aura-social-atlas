import { useEffect, useSyncExternalStore } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getCircleFeed, getFedizenHome, getForYou } from '@/lib/fedizen.functions';
import { getFedizenPublic, getRecentArticles } from '@/lib/bonfire.functions';
import { BASE_FEEDS, circleFeed, hasNew, markFeedSeen, newestOf, useFeedsSeen, usePinnedCircles, type FeedKind } from '@/lib/feed-types';
import { useAtlasAuth } from './AuthState';

/** For You, read through the person's Fedizen connection. */
export function useForYou(enabled: boolean) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getForYou);
  const id = user?.id;
  return useQuery({
    queryKey: ['fedizen-foryou', id],
    queryFn: () => { if (!id) throw new Error('Atlas user is not signed in.'); return read({ data: { expectedAtlasUserId: id } }); },
    enabled: !!id && enabled, staleTime: 60_000,
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
/** `active` is null until the view has restored the feed it was on, so the default tab isn't counted as seen. */
export function useFeedTabs(active: FeedKind | null): FeedTab[] {
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
  const forYou = useForYou(!!uid);
  const articles = useQuery({ queryKey: ['bonfire-articles'], queryFn: () => getRecentArticles(), staleTime: 5 * 60_000 });
  const local = useQuery({ queryKey: ['fedizen-public'], queryFn: () => getFedizenPublic(), staleTime: 60_000 });
  const circles = useQueries({ queries: pinned.map(c => ({
    queryKey: ['fedizen-circle-feed', uid, c.id],
    queryFn: () => { if (!uid) throw new Error('Nothing to read.'); return circle({ data: { expectedAtlasUserId: uid, id: c.id } }); },
    enabled: !!uid, staleTime: 60_000,
  })) });
  const newest: Record<string, string | undefined> = {
    following: newestOf(following.data?.posts), foryou: newestOf(forYou.data?.posts),
    articles: newestOf(articles.data?.articles), local: newestOf(local.data?.posts),
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
