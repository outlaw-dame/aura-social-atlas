import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getGroupedNotifications, getNotificationMarker, setNotificationMarker } from '@/lib/fedizen.functions';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { combineMultiPost, inFilter, isUnreadGroup, mergeNoticeGroups, newerId, type FedizenNoticeGroup, type NoticeFilter } from '@/lib/fedizen-feed';
import { useAtlasAuth } from './AuthState';
import { LIBRARY_PROBLEM } from './useFedizenLibrary';
import { useFilteredOut, useFollowedAmong, usePostFilter } from './useIntelligence';
import { LIVE_NOTICE_EVENT } from './LiveUpdates';

/** People you follow is read from All (Fedizen can't filter by who you follow), so it shares All's pages. */
const source = (f: NoticeFilter): NoticeFilter => (f === 'following' ? 'all' : f);
const groupsKey = (uid: string | undefined, f: NoticeFilter) => ['fedizen-notification-groups', uid, source(f)] as const;
const markerKey = (uid: string | undefined) => ['fedizen-notification-marker', uid] as const;

/**
 * Activity, grouped (Mastodon 4.3's grouped notifications through Fedizen), in Bluesky's tabs: All, Replies (with
 * mentions and quotes), Follows, and People you follow. Groups split across pages are joined (Bonfire groups within a
 * page), and one person's likes or boosts on several posts become one row. Older pages load on request.
 */
export function useNotificationGroups(filter: NoticeFilter, enabled = true) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getGroupedNotifications);
  const q = useInfiniteQuery({
    queryKey: groupsKey(user?.id, filter),
    queryFn: ({ pageParam }) => read({ data: { expectedAtlasUserId: user!.id, filter: source(filter), ...(pageParam ? { max: pageParam } : {}) } }),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.next ?? null,
    enabled: !!user && enabled,
    staleTime: 30_000,
  });
  const all = useMemo(() => combineMultiPost(mergeNoticeGroups((q.data?.pages ?? []).flatMap(p => p.groups))), [q.data]);
  const ids = useMemo(() => (filter === 'following' ? [...new Set(all.flatMap(g => g.people.flatMap(p => (p.id ? [p.id] : []))))].slice(0, 200) : []), [all, filter]);
  const followed = useFollowedAmong(ids);
  const groups = useMemo(() => all.filter(g => inFilter(g, filter, followed)), [all, filter, followed]);
  const err = q.data?.pages[0]?.error;
  return {
    groups, loading: q.isLoading, refreshing: q.isRefetching,
    error: err && err !== 'not-connected' ? LIBRARY_PROBLEM[err] ?? LIBRARY_PROBLEM.unavailable : q.isError ? LIBRARY_PROBLEM.unavailable : null,
    /** Fedizen answered nothing usable for v2 (older servers): Activity falls back to single notifications. */
    unsupported: !!err && err !== 'not-connected' && err !== 'expired',
    more: q.hasNextPage ? () => void q.fetchNextPage() : null, loadingMore: q.isFetchingNextPage,
    refresh: () => q.refetch(),
  };
}

/** The reader's notifications marker (Mastodon /api/v1/markers): the newest notification they've read. */
function useMarker() {
  const { user } = useAtlasAuth();
  const read = useServerFn(getNotificationMarker);
  const q = useQuery({
    queryKey: markerKey(user?.id),
    queryFn: () => read({ data: { expectedAtlasUserId: user!.id } }),
    enabled: !!user, staleTime: 30_000,
  });
  /** Undefined until known; null when Fedizen has none (nothing read yet) or couldn't say. */
  return { lastRead: q.data ? q.data.lastRead : undefined, known: !!q.data && !q.data.error };
}

/** How many notifications are unread, from All's first page and the marker: the Activity tab's badge. */
export function useUnreadActivity(): number {
  const { user } = useAtlasAuth();
  const m = useMarker();
  const g = useNotificationGroups('all', !!user);
  // What Activity leaves out (a filter caught the post) isn't counted either.
  const posts = useMemo(() => g.groups.flatMap(x => (x.status ? [x.status] : [])), [g.groups]);
  const out = useFilteredOut(posts, 'home');
  return useMemo(() => (m.known ? g.groups.filter(x => isUnreadGroup(x, m.lastRead) && !(x.status && out.has(x.status.id))).reduce((n, x) => n + x.count, 0) : 0), [g.groups, m.known, m.lastRead, out]);
}
/** The badge's words: "30+" past what one page can tell. */
export const badgeText = (n: number) => (n <= 0 ? '' : n > 30 ? '30+' : String(n));

/**
 * Unread rows while Activity is on screen, as Bluesky does it: what was unread when the reader arrived stays tinted
 * for the visit, and All marks everything it showed as read on Fedizen (the badge clears; other apps agree). The
 * other tabs leave things out, so only All marks. A refresh starts a new visit.
 */
export function useActivityReadState(groups: FedizenNoticeGroup[], { visible, filter }: { visible: boolean; filter: NoticeFilter }) {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const m = useMarker();
  const write = useServerFn(setNotificationMarker);
  const [since, setSince] = useState<string | null | undefined>(undefined);
  // The marker as it was when this visit began.
  useEffect(() => { if (visible && since === undefined && m.lastRead !== undefined) setSince(m.lastRead); }, [visible, since, m.lastRead]);
  useEffect(() => { if (!visible) setSince(undefined); }, [visible]);
  const mark = useMutation({
    mutationFn: (lastRead: string) => write({ data: { expectedAtlasUserId: user!.id, lastRead } }),
    onSuccess: (r, lastRead) => { if (r.ok) qc.setQueryData(markerKey(user?.id), { lastRead }); },
  });
  const newest = groups.reduce<string | undefined>((a, g) => (g.latestId && (!a || newerId(g.latestId, a)) ? g.latestId : a), undefined);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!user || !visible || filter !== 'all' || !m.known || !newest || sent.current === newest) return;
    if (m.lastRead && !newerId(newest, m.lastRead)) return;
    sent.current = newest;
    mark.mutate(newest);
  }, [user, visible, filter, m.known, m.lastRead, newest]); // eslint-disable-line react-hooks/exhaustive-deps
  const isUnread = useCallback((g: FedizenNoticeGroup) => since !== undefined && isUnreadGroup(g, since), [since]);
  /** Start a new visit: what's been seen stops being tinted. */
  const restart = useCallback(() => setSince(m.lastRead), [m.lastRead]);
  return { isUnread, restart };
}

/**
 * New notifications arrived (Fedizen's live stream) while Activity is open: a "New activity" pill rather than rows
 * jumping under the reader's finger, as Bluesky's Refresh pill. Showing them refetches and starts a new visit.
 */
export function useNewActivityPill(refresh: () => Promise<unknown> | void, restart: () => void) {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    const on = () => setFresh(true);
    window.addEventListener(LIVE_NOTICE_EVENT, on);
    return () => window.removeEventListener(LIVE_NOTICE_EVENT, on);
  }, []);
  const show = useCallback(async () => { setFresh(false); await refresh(); restart(); }, [refresh, restart]);
  return { fresh, show };
}

/**
 * Whether Activity leaves a post out: a filter hides or warns on it (a blur only veils its media, so it stays), or the
 * check is still running. No notice is shown in Activity; the filter's count in Settings records it.
 */
export function useHiddenByFilter(post: FedizenPost): boolean {
  const { verdict } = usePostFilter(post);
  return verdict.state === 'pending' || (verdict.state === 'filtered' && verdict.action !== 'blur');
}
