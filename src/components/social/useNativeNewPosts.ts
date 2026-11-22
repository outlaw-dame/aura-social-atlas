import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { getNativeBonfireHomeLatest } from '@/lib/bonfire-private.functions';
import { nativeNewPosts } from '@/lib/bonfire-native-presentation';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { CHECK_MIN, nextCheckDelay } from '@/lib/home-timeline';
import { newPostFaces } from '@/lib/new-post-faces';
import { useAtlasAuth } from './AuthState';
import { useShownPosts } from './useIntelligence';

/**
 * New posts for native (GraphQL) Home, as useHomeTimeline finds them for the REST one: the newest GraphQL page is
 * checked every 30 s while the reader is active (backing off to 5 min when nothing happens, never while the page is
 * hidden, at once when they come back), without reading each post. What's new waits behind the pill (the faces of who
 * posted, only from posts the reader's filters would show); showing them reads Home again from the top, with full
 * cards. `refresh` re-reads native Home; `list` is the feed's list element, to scroll back to.
 */
export function useNativeNewPosts(enabled: boolean, shown: readonly FedizenPost[], refresh: () => Promise<void>, list: RefObject<HTMLElement | null>) {
  const { user } = useAtlasAuth();
  const id = user?.id;
  const latestFn = useServerFn(getNativeBonfireHomeLatest);
  const [pending, setPending] = useState<{ posts: FedizenPost[]; gap: boolean }>({ posts: [], gap: false });
  const visible = useShownPosts(pending.posts);
  const faces = useMemo(() => newPostFaces(visible), [visible]);
  const state = useRef({ shown, pending }); state.current = { shown, pending };
  const delay = useRef(CHECK_MIN), lastActive = useRef(Date.now()), running = useRef(false), lastCheck = useRef(Date.now());

  // A new feed (account change, or after showing what was new) clears what was waiting.
  useEffect(() => { setPending({ posts: [], gap: false }); }, [id, enabled]);

  const check = useCallback(async () => {
    if (!id || !enabled || running.current || typeof document === 'undefined' || document.hidden) return false;
    running.current = true; lastCheck.current = Date.now();
    try {
      const r = await latestFn({ data: { expectedAtlasUserId: id } }).catch(() => null);
      if (!r || r.status !== 'available') return false;
      const { fresh, gap } = nativeNewPosts(r.posts, [...state.current.pending.posts, ...state.current.shown]);
      if (!fresh.length) return false;
      setPending(w => ({ posts: [...fresh, ...w.posts], gap: w.gap || gap }));
      return true;
    } finally { running.current = false; }
  }, [id, enabled, latestFn]);

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
    const onVisible = () => {
      if (document.hidden) { clearTimeout(timer); return; }
      if (Date.now() - lastCheck.current > CHECK_MIN) void tick(); else schedule();
    };
    const online = () => void tick();
    schedule();
    window.addEventListener('scroll', active, { passive: true, capture: true });
    window.addEventListener('pointerdown', active, { passive: true });
    window.addEventListener('keydown', active);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', online);
    return () => {
      alive = false; clearTimeout(timer);
      window.removeEventListener('scroll', active, { capture: true });
      window.removeEventListener('pointerdown', active);
      window.removeEventListener('keydown', active);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', online);
    };
  }, [enabled, id, check]);

  const [revealing, setRevealing] = useState(false);
  const reveal = useCallback(async () => {
    if (revealing) return;
    setRevealing(true);
    try {
      await refresh();
      setPending({ posts: [], gap: false });
      const el = list.current;
      if (el) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 96), behavior: 'smooth' });
    } finally { setRevealing(false); }
  }, [refresh, list, revealing]);

  return { newCount: visible.length, gap: pending.gap, faces, reveal, revealing };
}
