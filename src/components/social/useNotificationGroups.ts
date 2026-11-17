import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getGroupedNotifications } from '@/lib/fedizen.functions';
import { mergeNoticeGroups } from '@/lib/fedizen-feed';
import { useAtlasAuth } from './AuthState';
import { LIBRARY_PROBLEM } from './useFedizenLibrary';

/**
 * Activity, grouped (Mastodon 4.3's grouped notifications through Fedizen): all, or mentions only, as Bluesky's
 * Activity offers "All" and "Mentions". Older pages load on request; groups split across pages are joined.
 */
export function useNotificationGroups(mentions: boolean, enabled = true) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getGroupedNotifications);
  const q = useInfiniteQuery({
    queryKey: ['fedizen-notification-groups', user?.id, mentions],
    queryFn: ({ pageParam }) => read({ data: { expectedAtlasUserId: user!.id, mentions, ...(pageParam ? { max: pageParam } : {}) } }),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.next ?? null,
    enabled: !!user && enabled,
    staleTime: 30_000,
  });
  const groups = useMemo(() => mergeNoticeGroups((q.data?.pages ?? []).flatMap(p => p.groups)), [q.data]);
  const err = q.data?.pages[0]?.error;
  return {
    groups, loading: q.isLoading, refreshing: q.isRefetching,
    error: err && err !== 'not-connected' ? LIBRARY_PROBLEM[err] ?? LIBRARY_PROBLEM.unavailable : q.isError ? LIBRARY_PROBLEM.unavailable : null,
    /** Fedizen answered nothing usable for v2 (older servers): Activity falls back to single notifications. */
    unsupported: !!err && err !== 'not-connected' && err !== 'expired',
    more: q.hasNextPage ? () => void q.fetchNextPage() : null, loadingMore: q.isFetchingNextPage,
    refresh: () => void q.refetch(),
  };
}
