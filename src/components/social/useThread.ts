import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { findCachedPost } from '@/lib/post-cache';
import { useServerFn } from '@tanstack/react-start';
import { getFedizenThread } from '@/lib/fedizen.functions';
import { getOriginReplies } from '@/lib/origin-replies.functions';
import { originOf, repliesFedizenLacks } from '@/lib/origin-replies';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { buildThread, type ReplySort } from '@/lib/thread';
import { nextReadIn, reconcile, touches, withDeleted, type ThreadData } from '@/lib/thread-live';
import { useAtlasAuth } from './AuthState';
import { getFedizenStatus } from '@/lib/fedizen.functions';
import { fullAcct } from '@/lib/fedizen-feed';
import { LIVE_NOTICE_EVENT, LIVE_POST_EVENT } from './LiveUpdates';
import { deletedPosts } from './useOwnPosts';

const SORT_KEY = 'atlas.thread.sort';
function savedSort(): ReplySort {
  try { const v = localStorage.getItem(SORT_KEY); return v === 'newest' || v === 'top' ? v : 'oldest'; } catch { return 'oldest'; }
}

// While a conversation is open and on screen it's read again every CHECK_MS (thread-live.ts): Fedizen's live stream
// only carries posts that land in the reader's Home and their notifications, not a stranger's reply in someone else's
// thread. A read that didn't come back whole is tried again after 4 s and 12 s first (nextReadIn).
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
  const originFn = useServerFn(getOriginReplies);
  const statusFn = useServerFn(getFedizenStatus);
  // Same query as the rest of Atlas reads the connection with (useIsMe).
  const status = useQuery({ queryKey: ['fedizen-status', user?.id], queryFn: () => statusFn(), enabled: !!user, staleTime: 60_000 });
  const id = user?.id;
  // Reads in a row that didn't come back whole (Fedizen slow or refusing), for the retry pace.
  const failures = useRef(0);
  const q = useQuery({
    queryKey: ['fedizen-thread', id, statusId],
    queryFn: async () => {
      try {
        const r = await read({ data: { expectedAtlasUserId: id!, statusId: statusId! } });
        failures.current = r.error && r.error !== 'not-found' ? failures.current + 1 : 0;
        return r;
      } catch (e) { failures.current += 1; throw e; }
    },
    enabled: !!id && !!statusId,
    staleTime: 30_000,
    refetchInterval: () => nextReadIn(failures.current),
  });
  const [sort, setSortState] = useState<ReplySort>(savedSort);
  const setSort = (s: ReplySort) => { setSortState(s); try { localStorage.setItem(SORT_KEY, s); } catch { /* per-device convenience only */ } };
  const me = fullAcct(status.data?.handle)?.toLowerCase();
  const isMe = useCallback((p: FedizenPost) => !!me && fullAcct(p.acct ?? p.handle)?.toLowerCase() === me, [me]);
  const deleted = useSyncExternalStore(deletedPosts.subscribe, deletedPosts.snapshot, deletedPosts.snapshot);

  // What the reader is looking at, reconciled with each read of Fedizen.
  type View = { id: string; data: ThreadData; arrived: ReadonlyMap<string, number> };
  const [view, setView] = useState<View | null>(null);
  useEffect(() => { failures.current = 0; }, [statusId]);
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
  // Until Fedizen answers: the post that was tapped, else the same post from anywhere Atlas already has it (a feed,
  // Saved, Activity's post, another conversation), so it opens at once from a notification or a link too.
  const qc = useQueryClient();
  const cached = useMemo(() => (seed?.statusId === statusId ? seed : statusId && !current
    ? findCachedPost(qc.getQueryCache().getAll().filter(x => x.queryKey[0] !== 'fedizen-thread' || x.queryKey[2] !== statusId).map(x => x.state.data), statusId)
    : undefined), [seed, statusId, qc, !current]); // eslint-disable-line react-hooks/exhaustive-deps
  // Fedizen says the post is gone: don't keep showing the copy Atlas had.
  const focus = current?.data.post ?? (q.data?.error === 'not-found' ? undefined : cached);
  // Replies on the post's own server that Fedizen hasn't received (origin-replies.ts), read-only. Added when the thread
  // is built, never into what Fedizen sent, so a later read of Fedizen can't take them for deleted posts.
  const origin = originOf(current?.data.post.url ?? focus?.url);
  const fromOrigin = useQuery({
    // Per reader: their blocks and mutes are applied on the server.
    queryKey: ['origin-replies', id, origin?.host, origin?.id],
    queryFn: () => originFn({ data: { expectedAtlasUserId: id!, url: (current?.data.post.url ?? focus?.url)! } }),
    // Read once a conversation opens and every 5 minutes after, not on every focus: each read checks the reply
    // authors with Fedizen, and that load counts toward its rate limit.
    enabled: !!id && !!origin && origin.host !== 'fedizen.net' && !!current, staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false,
  });
  const originExtra = useMemo(() => (origin && current && fromOrigin.data?.replies.length
    ? repliesFedizenLacks(origin, current.data.post, [current.data.post, ...current.data.ancestors, ...current.data.descendants], fromOrigin.data.replies)
    : NO_POSTS), [origin?.host, origin?.id, current?.data, fromOrigin.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const thread = useMemo(() => (focus ? buildThread(focus, current?.data.ancestors ?? [], [...(current?.data.descendants ?? []), ...originExtra], { sort, isMe }) : null), [focus, current?.data, originExtra, sort, isMe]);
  return {
    thread, loading: q.isLoading, refreshing: q.isFetching && !q.isLoading,
    error: q.isError ? 'unavailable' as const : q.data?.error, refetch: () => void q.refetch(), sort, setSort, signedIn: !!user,
    /** The last read failed because Fedizen didn't answer in time (or couldn't be reached), not because it refused.
     *  Only Atlas's server can tell: a request that failed on the way to Atlas itself isn't called slow. */
    slow: !q.isError && !!q.data?.slow,
    /** Fedizen sent as many replies as it sends at most: there may be more on fedizen.net. */ capped: !!q.data?.capped,
    /** Posts added while the conversation was open, and when (ms). */ arrived: current?.arrived ?? EMPTY,
  };
}

const EMPTY: ReadonlyMap<string, number> = new Map();
const NO_POSTS: FedizenPost[] = [];
/** When the post itself didn't load because Fedizen didn't answer in time. */
export const SLOW_CONVERSATION = 'Fedizen is slow to answer right now. Atlas will keep trying.';
