import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getFedizenThread } from '@/lib/fedizen.functions';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { buildThread, type ReplySort } from '@/lib/thread';
import { reconcile, touches, withDeleted, type ThreadData } from '@/lib/thread-live';
import { useAtlasAuth } from './AuthState';
import { getFedizenStatus } from '@/lib/fedizen.functions';
import { fullAcct } from '@/lib/fedizen-feed';
import { LIVE_NOTICE_EVENT, LIVE_POST_EVENT } from './LiveUpdates';
import { deletedPosts } from './useOwnPosts';

const SORT_KEY = 'atlas.thread.sort';
function savedSort(): ReplySort {
  try { const v = localStorage.getItem(SORT_KEY); return v === 'newest' || v === 'top' ? v : 'oldest'; } catch { return 'oldest'; }
}

/** While a conversation is open and on screen, it's read again this often: Fedizen's live stream only carries posts
 *  that land in the reader's Home and their notifications, not a stranger's reply in someone else's thread. */
const CHECK_MS = 45_000;
/** Live events in a burst lead to one read. */
const SETTLE_MS = 800;

const key = (p: FedizenPost) => p.statusId ?? p.id;

/**
 * A post's conversation from Fedizen, arranged; the post that was tapped shows at once while the rest loads. Kept
 * up to date while open (thread-live.ts): read again on a live post or notification that may belong to it, every
 * 45 s while visible, on returning to the tab and on reconnecting. Edits, deletions and new replies show in place at
 * once; `arrived` says which posts were added while open, and when (the page keeps the reader's place and marks them).
 */
export function useThread(statusId: string | null, seed?: FedizenPost) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getFedizenThread);
  const statusFn = useServerFn(getFedizenStatus);
  // Same query as the rest of Atlas reads the connection with (useIsMe).
  const status = useQuery({ queryKey: ['fedizen-status', user?.id], queryFn: () => statusFn(), enabled: !!user, staleTime: 60_000 });
  const id = user?.id;
  const q = useQuery({
    queryKey: ['fedizen-thread', id, statusId],
    queryFn: () => read({ data: { expectedAtlasUserId: id!, statusId: statusId! } }),
    enabled: !!id && !!statusId,
    staleTime: 30_000,
    refetchInterval: CHECK_MS,
  });
  const [sort, setSortState] = useState<ReplySort>(savedSort);
  const setSort = (s: ReplySort) => { setSortState(s); try { localStorage.setItem(SORT_KEY, s); } catch { /* per-device convenience only */ } };
  const me = fullAcct(status.data?.handle)?.toLowerCase();
  const isMe = useCallback((p: FedizenPost) => !!me && fullAcct(p.acct ?? p.handle)?.toLowerCase() === me, [me]);
  const deleted = useSyncExternalStore(deletedPosts.subscribe, deletedPosts.snapshot, deletedPosts.snapshot);

  // What the reader is looking at, reconciled with each read of Fedizen.
  type View = { id: string; data: ThreadData; arrived: ReadonlyMap<string, number> };
  const [view, setView] = useState<View | null>(null);
  useEffect(() => {
    const live = q.data;
    if (!statusId || !live?.post) return;
    const data: ThreadData = { post: live.post, ancestors: live.ancestors, descendants: live.descendants };
    setView(v => {
      if (!v || v.id !== statusId) return { id: statusId, data, arrived: new Map() };
      const r = reconcile(v.data, data, { deleted, complete: !live.error });
      if (!r.added.length) return { ...v, data: r.shown };
      const arrived = new Map(v.arrived);
      const at = Date.now();
      r.added.forEach(p => arrived.set(key(p), at));
      return { ...v, data: r.shown, arrived };
    });
  }, [q.data, statusId]); // eslint-disable-line react-hooks/exhaustive-deps
  // A post deleted while open becomes its placeholder at once.
  useEffect(() => {
    setView(v => {
      if (!v) return v;
      let data = v.data;
      for (const d of deleted) data = withDeleted(data, d);
      return { ...v, data };
    });
  }, [deleted]);

  // Live events that may concern this conversation: read it again, once per burst.
  const viewRef = useRef(view);
  viewRef.current = view;
  const refetch = q.refetch;
  useEffect(() => {
    if (!statusId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => void refetch(), SETTLE_MS); };
    const onPost = (e: Event) => {
      const p = (e as CustomEvent<{ post?: FedizenPost }>).detail?.post;
      if (p && viewRef.current && touches(viewRef.current.data, p)) soon();
    };
    window.addEventListener(LIVE_POST_EVENT, onPost);
    window.addEventListener(LIVE_NOTICE_EVENT, soon);
    return () => { clearTimeout(timer); window.removeEventListener(LIVE_POST_EVENT, onPost); window.removeEventListener(LIVE_NOTICE_EVENT, soon); };
  }, [statusId, refetch]);

  const current = view && view.id === statusId ? view : null;
  const focus = current?.data.post ?? (seed?.statusId === statusId ? seed : undefined);
  const thread = useMemo(() => (focus ? buildThread(focus, current?.data.ancestors ?? [], current?.data.descendants ?? [], { sort, isMe }) : null), [focus, current?.data, sort, isMe]);
  return {
    thread, loading: q.isLoading, refreshing: q.isFetching && !q.isLoading,
    error: q.isError ? 'unavailable' as const : q.data?.error, refetch: () => void q.refetch(), sort, setSort, signedIn: !!user,
    /** Posts added while the conversation was open, and when (ms). */ arrived: current?.arrived ?? EMPTY,
  };
}

const EMPTY: ReadonlyMap<string, number> = new Map();
