import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { appendOlder } from '@/lib/home-timeline';

type Page<P, C> = { posts: P[]; next?: C; error?: unknown };

/**
 * A feed's older pages, below its first: read from the cursor the first page ended on, one page ahead of the reader
 * (the next page is asked for as soon as the one before it arrives on screen, and again as the reader nears the end),
 * and kept in the query cache, so switching tabs or reopening the feed doesn't read them again. Pages that overlap
 * (posts arrived in between) show each post once.
 */
export function useOlderPages<P extends { id: string }, C>(key: readonly unknown[], first: P[], start: C | undefined, read: (cursor: C) => Promise<Page<P, C>>, enabled: boolean) {
  const q = useInfiniteQuery({
    queryKey: [...key, 'older', start ?? null],
    queryFn: ({ pageParam }) => read(pageParam as C),
    initialPageParam: start as C,
    getNextPageParam: (last: Page<P, C>) => (last.error ? undefined : last.next),
    enabled: enabled && start != null, staleTime: 5 * 60_000,
  });
  const pages = q.data?.pages;
  const posts = useMemo(() => (pages ?? []).reduce<P[]>((all, pg) => appendOlder(all, pg.posts), first).slice(first.length), [pages, first]);
  const last = pages?.[pages.length - 1];
  const { hasNextPage, isFetchingNextPage, isFetching, fetchNextPage, refetch } = q;
  const failed = !!last?.error || q.isError;
  const loadMore = useCallback(() => {
    if (failed && pages?.length === 1 && !pages[0].posts.length) void refetch();
    else if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [failed, pages, refetch, hasNextPage, isFetchingNextPage, fetchNextPage]);
  return { posts, hasMore: start != null && (!pages || !!hasNextPage || failed), loading: isFetching, failed, loadMore };
}

/** The element at a feed's end: as it comes within 1600 px of the screen, the next older page is read. */
export function useLoadMoreSentinel(active: boolean, loadMore: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !active || typeof IntersectionObserver === 'undefined') return;
    const root = (el.closest('.page-content') as HTMLElement | null) ?? null;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) loadMore(); }, { root, rootMargin: '0px 0px 1600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [active, loadMore]);
  return ref;
}
