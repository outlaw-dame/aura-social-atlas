import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getFedizenThread } from '@/lib/fedizen.functions';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { buildThread, type ReplySort } from '@/lib/thread';
import { useAtlasAuth } from './AuthState';
import { getFedizenStatus } from '@/lib/fedizen.functions';
import { fullAcct } from '@/lib/fedizen-feed';

const SORT_KEY = 'atlas.thread.sort';
function savedSort(): ReplySort {
  try { const v = localStorage.getItem(SORT_KEY); return v === 'newest' || v === 'top' ? v : 'oldest'; } catch { return 'oldest'; }
}

/** A post's conversation from Fedizen, arranged; the post that was tapped shows at once while the rest loads. */
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
  });
  const [sort, setSortState] = useState<ReplySort>(savedSort);
  const setSort = (s: ReplySort) => { setSortState(s); try { localStorage.setItem(SORT_KEY, s); } catch { /* per-device convenience only */ } };
  const me = fullAcct(status.data?.handle)?.toLowerCase();
  const focus = q.data?.post ?? (seed?.statusId === statusId ? seed : undefined);
  const thread = useMemo(() => (focus ? buildThread(focus, q.data?.ancestors ?? [], q.data?.descendants ?? [], { sort, isMe: p => !!me && fullAcct(p.acct ?? p.handle)?.toLowerCase() === me }) : null), [focus, q.data, sort, me]);
  return { thread, loading: q.isLoading, refreshing: q.isFetching && !q.isLoading, error: q.isError ? 'unavailable' as const : q.data?.error, refetch: () => void q.refetch(), sort, setSort, signedIn: !!user };
}
