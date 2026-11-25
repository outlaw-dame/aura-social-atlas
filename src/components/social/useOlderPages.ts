import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

/** Older posts load on their own wherever IntersectionObserver exists; elsewhere the footer offers a button. */
export const autoLoads = () => typeof IntersectionObserver !== 'undefined';

/** How far ahead of the reader the next page is read, in screen heights (Bluesky's web list reads 2 ahead,
 *  onEndReachedThreshold; Atlas reads a little further because Fedizen can take a second or two per page). */
export const LOOKAHEAD_SCREENS = 3;

/** The element that scrolls `el`: the nearest ancestor that scrolls (Framework7's .page-content, a dialog), else the
 *  window (null, for IntersectionObserver). An observer rooted at the window can't see past a scrolling box's edge. */
export function scrollRootOf(el: Element): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    if (n.classList.contains('page-content')) return n;
    const o = getComputedStyle(n).overflowY;
    if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/**
 * The element at a feed's end: as it comes within LOOKAHEAD_SCREENS screens of view, the next older page is read, and
 * the next after it while the end stays that near (an observer only speaks when the end comes into or out of range,
 * so after each page Atlas checks again; Bluesky's list does the same by re-creating its observer whenever the list's
 * height changes). A callback ref, so an end element that is replaced is observed again.
 */
export function useLoadMoreSentinel(active: boolean, loadMore: () => void) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const near = useRef(false);
  const load = useRef(loadMore);
  load.current = loadMore;
  useEffect(() => {
    if (!el || !active || typeof IntersectionObserver === 'undefined') return;
    const root = scrollRootOf(el);
    const screen = root?.clientHeight || window.innerHeight || 800;
    const io = new IntersectionObserver(es => {
      near.current = es.some(e => e.isIntersecting);
      if (near.current) load.current();
    }, { root, rootMargin: `0px 0px ${Math.round(LOOKAHEAD_SCREENS * screen)}px 0px` });
    io.observe(el);
    return () => { io.disconnect(); near.current = false; };
  }, [el, active]);
  // loadMore changes as a read starts and ends: if the end is still in range once a page is in, read the next.
  useEffect(() => { if (active && near.current) loadMore(); }, [active, loadMore]);
  return setEl;
}
