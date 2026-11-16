import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getFedizenHomeLatest, getFedizenHomePage, type FedizenHome } from '@/lib/fedizen.functions';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { appendOlder, CHECK_MIN, newerThan, nextCheckDelay } from '@/lib/home-timeline';
import { useReading } from '@/lib/reading-prefs';
import { useAtlasAuth } from './AuthState';
import { useShownCount } from './useIntelligence';

/** The element that scrolls the feed: Framework7's page content on the phone, the window on desktop. */
const scroller = (el: Element | null): HTMLElement | null => (el?.closest('.page-content') as HTMLElement | null) ?? null;

function preload(posts: FedizenPost[]) {
  for (const p of posts) for (const src of [p.image, p.avatar]) if (src) { const i = new Image(); i.decoding = 'async'; i.src = src; }
}

/**
 * Home that stays fresh without moving what's being read (lib/home-timeline has the how and why):
 * - opens on the Home kept on this device, then checks for new posts at once;
 * - checks every 30 s while the person is reading, backing off to 5 min when nothing happens, never while the page
 *   is hidden, and right away when they come back or the network does;
 * - new posts the person's filters would show wait behind "N new posts" (images loaded ahead); at the very top they
 *   slide straight in, unless Slow mode is on;
 * - the next older page is fetched before the reader reaches the end.
 * `list` is the feed's list element (to tell "at the top" and to scroll back to it).
 */
export function useHomeTimeline(data: FedizenHome | undefined, enabled: boolean, list: RefObject<HTMLElement | null>, dataUpdatedAt = 0) {
  const { user } = useAtlasAuth();
  const id = user?.id;
  const qc = useQueryClient();
  const latestFn = useServerFn(getFedizenHomeLatest), pageFn = useServerFn(getFedizenHomePage);
  const { slowMode } = useReading();
  const key = useMemo(() => ['fedizen-home', id] as const, [id]);

  // Older pages, appended below the first. They belong to the first page they continued from.
  const [older, setOlder] = useState<{ from?: string; posts: FedizenPost[]; next?: string; loading: boolean; failed: boolean }>({ posts: [], loading: false, failed: false });
  const olderNow = older.from === data?.next ? older : { from: data?.next, posts: [] as FedizenPost[], next: undefined, loading: false, failed: false };
  const cursor = olderNow.posts.length ? olderNow.next : data?.next;
  const posts = useMemo(() => appendOlder(data?.posts ?? [], olderNow.posts), [data?.posts, olderNow.posts]);
  const loadOlder = useCallback(async () => {
    if (!id || !enabled || !cursor || olderNow.loading) return;
    const from = data?.next;
    setOlder({ ...olderNow, loading: true, failed: false });
    const r = await pageFn({ data: { expectedAtlasUserId: id, max: cursor } }).catch(() => ({ posts: [] as FedizenPost[], error: 'unavailable' as const }));
    setOlder(o => (o.from !== from ? o : 'error' in r && r.error
      ? { ...olderNow, from, loading: false, failed: true }
      : { from, posts: [...olderNow.posts, ...r.posts], next: r.next, loading: false, failed: false }));
  }, [id, enabled, cursor, olderNow, data?.next, pageFn]);

  // New posts waiting behind the pill.
  const [pending, setPending] = useState<{ posts: FedizenPost[]; gap: boolean; next?: string }>({ posts: [], gap: false });
  const shown = useShownCount(pending.posts);
  const atTop = useCallback(() => {
    const el = list.current;
    if (!el) return false;
    const box = scroller(el);
    const top = el.getBoundingClientRect().top - (box ? box.getBoundingClientRect().top : 0);
    return top >= -8; // the first post hasn't been scrolled past
  }, [list]);
  const scrollToList = useCallback(() => {
    const el = list.current;
    if (!el) return;
    const box = scroller(el);
    const offset = 96;
    // On the phone the page's top padding is the navbar's height: land just below it.
    if (box) box.scrollTo({ top: Math.max(0, box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - (parseFloat(getComputedStyle(box).paddingTop) || 0) - 8), behavior: 'smooth' });
    else window.scrollTo({ top: Math.max(0, window.scrollY + el.getBoundingClientRect().top - offset), behavior: 'smooth' });
  }, [list]);

  const put = useCallback((fresh: FedizenPost[], gap: boolean, next?: string) => {
    qc.setQueryData<FedizenHome>(key, d => (d ? (gap ? { ...d, posts: fresh, ...(next ? { next } : {}) } : { ...d, posts: [...fresh, ...d.posts.filter(p => !fresh.some(f => f.id === p.id))] }) : d));
  }, [qc, key]);

  const reveal = useCallback(() => {
    if (!pending.posts.length) return;
    put(pending.posts, pending.gap, pending.next);
    setPending({ posts: [], gap: false });
    scrollToList();
  }, [pending, put, scrollToList]);

  const delay = useRef(CHECK_MIN), lastCheck = useRef(0), lastActive = useRef(Date.now()), running = useRef(false);
  const state = useRef({ posts, pending, slowMode, enabled }); state.current = { posts, pending, slowMode, enabled };
  const check = useCallback(async () => {
    if (!id || !state.current.enabled || running.current || typeof document === 'undefined' || document.hidden) return false;
    running.current = true; lastCheck.current = Date.now();
    try {
      const r = await latestFn({ data: { expectedAtlasUserId: id } }).catch(() => null);
      if (!r || 'error' in r && r.error) return false;
      if (r.notices) qc.setQueryData<FedizenHome>(key, d => (d ? { ...d, notices: r.notices! } : d));
      const { posts: current, pending: waiting, slowMode: slow } = state.current;
      const { fresh, gap } = newerThan([...waiting.posts, ...current], r.posts);
      if (!fresh.length) return false;
      preload(fresh);
      if (!slow && !waiting.posts.length && !gap && atTop()) put(fresh, false);
      else setPending(w => ({ posts: [...fresh, ...w.posts], gap: w.gap || gap, next: gap ? r.next : w.next }));
      return true;
    } finally { running.current = false; }
  }, [id, latestFn, qc, key, put, atTop]);

  // The checking rhythm.
  useEffect(() => {
    if (!enabled || !id) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const schedule = () => { clearTimeout(timer); if (alive && !document.hidden) timer = setTimeout(tick, delay.current); };
    const tick = async () => {
      const found = await check();
      delay.current = nextCheckDelay(delay.current, found, Date.now() - lastActive.current < 60_000);
      schedule();
    };
    const active = () => { lastActive.current = Date.now(); };
    const visible = () => {
      if (document.hidden) { clearTimeout(timer); return; }
      if (Date.now() - lastCheck.current > CHECK_MIN) void tick(); else schedule();
    };
    const online = () => void tick();
    // Opening on a Home kept from earlier: check now rather than in 30 s.
    if (Date.now() - Math.max(dataUpdatedAt, lastCheck.current) > CHECK_MIN) void tick(); else schedule();
    window.addEventListener('scroll', active, { passive: true, capture: true });
    window.addEventListener('pointerdown', active, { passive: true });
    window.addEventListener('keydown', active);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', online);
    return () => {
      alive = false; clearTimeout(timer);
      window.removeEventListener('scroll', active, { capture: true });
      window.removeEventListener('pointerdown', active);
      window.removeEventListener('keydown', active);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', online);
    };
  }, [enabled, id, check, dataUpdatedAt]);

  // Fetch the next older page a couple of screens before the reader gets there.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !enabled || !cursor || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) void loadOlder(); }, { root: scroller(el), rootMargin: '0px 0px 1600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, cursor, loadOlder]);

  return {
    posts, newCount: shown, gap: pending.gap, reveal,
    sentinel, hasOlder: !!cursor, loadingOlder: olderNow.loading, olderFailed: olderNow.failed, loadOlder,
  };
}
