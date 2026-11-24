import { useCallback, useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getFediFollow, getFediProfile, getProfilePosts, setFediFollow, type FollowState } from '@/lib/fedi-profile.functions';
import type { FediProfile } from '@/lib/fedi-profile';
import { mergeProfilePosts } from '@/lib/profile-posts';
import { getFedizenStatus } from '@/lib/fedizen.functions';
import { fullAcct } from '@/lib/fedizen-feed';
import { OPEN_FEDI_PROFILE_EVENT, type FediProfileTarget } from '@/lib/fedi-profile';
import { useAtlasAuth } from './AuthState';

/** The profile someone asked to open (from an author tag anywhere in Atlas); null when none is open. */
export function useFediProfileOpener() {
  const [target, setTarget] = useState<FediProfileTarget | null>(null);
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<FediProfileTarget>).detail; if (d?.actor || d?.acct) setTarget(d); };
    window.addEventListener(OPEN_FEDI_PROFILE_EVENT, on);
    return () => window.removeEventListener(OPEN_FEDI_PROFILE_EVENT, on);
  }, []);
  return { target, close: () => setTarget(null) };
}

export function useFediProfile(target: FediProfileTarget | null) {
  const read = useServerFn(getFediProfile);
  return useQuery({
    queryKey: ['fedi-profile', target?.actor ?? target?.acct],
    queryFn: () => read({ data: { actor: target?.actor, acct: target?.acct } }),
    enabled: !!target, staleTime: 5 * 60_000,
  });
}

export const FOLLOW_PROBLEM = {
  'not-connected': 'Connect Fedizen to follow people from Atlas.',
  'needs-permission': 'Reconnect Fedizen so Atlas can follow people for you.',
  expired: 'Fedizen ended Atlas’s access. Connect again to follow.',
  unavailable: 'Fedizen couldn’t do that right now. Try again.',
  'not-found': 'Fedizen couldn’t find this account yet.',
  unverified: 'Their server didn’t confirm this handle, so Atlas won’t follow it for you.',
} as const;

/** Whether this handle is the reader's own Fedizen account (their own profile offers no Follow). */
export function useIsMe(acct: string | undefined) {
  const { user } = useAtlasAuth();
  const statusFn = useServerFn(getFedizenStatus);
  // Same query (key and function) as the rest of Atlas reads Fedizen's connection status with.
  const status = useQuery({ queryKey: ['fedizen-status', user?.id], queryFn: () => statusFn(), enabled: !!user, staleTime: 60_000 });
  const mine = fullAcct(status.data?.handle), theirs = fullAcct(acct);
  return !!mine && !!theirs && mine.toLowerCase() === theirs.toLowerCase();
}

/** Follow state on the reader's Fedizen account, and the toggle. Only for a handle confirmed to be this actor's. */
export function useFediFollow(acct: string | undefined, actor: string | undefined) {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const read = useServerFn(getFediFollow), write = useServerFn(setFediFollow);
  const id = user?.id;
  const q = useQuery({
    queryKey: ['fedi-follow', id, acct, actor],
    queryFn: () => { if (!id || !acct || !actor) throw new Error('Nothing to read.'); return read({ data: { expectedAtlasUserId: id, acct, actor } }); },
    enabled: !!id && !!acct && !!actor, staleTime: 30_000,
  });
  const m = useMutation({
    mutationFn: async (on: boolean) => {
      if (!id || !acct || !actor) return { ok: false as const, error: 'not-connected' as const };
      return write({ data: { expectedAtlasUserId: id, acct, actor, on } });
    },
    onSuccess: r => {
      if (r.ok) qc.setQueryData(['fedi-follow', id, acct, actor], (old: { canWrite: boolean } | undefined) => ({ canWrite: old?.canWrite ?? true, state: r.state }));
      void qc.invalidateQueries({ queryKey: ['fedizen-home'] });
    },
  });
  const state: FollowState | undefined = q.data?.state;
  const error = m.data && !m.data.ok ? FOLLOW_PROBLEM[m.data.error] : m.isError ? FOLLOW_PROBLEM.unavailable : q.data?.error && q.data.error !== 'not-found' ? FOLLOW_PROBLEM[q.data.error] : null;
  return {
    signedIn: !!id, state, canFollow: !!q.data?.canWrite && !!state, busy: m.isPending || q.isLoading,
    toggle: () => m.mutate(state !== 'following' && state !== 'requested'), error,
  };
}

/**
 * A profile's posts as the reader's Fedizen has them (so they can be acted on), merged with the newest ones from the
 * account's own server that Fedizen hasn't received yet (lib/profile-posts). Signed out, not connected, or for a handle
 * its server didn't confirm, only the origin's posts. Older Fedizen pages load as the reader nears the end, and stay
 * cached while the profile is reopened.
 */
export function useProfilePosts(p: FediProfile | undefined) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getProfilePosts);
  const id = user?.id;
  const enabled = !!id && !!p?.acctVerified && p.kind !== 'group';
  const q = useInfiniteQuery({
    queryKey: ['fedizen-account-posts', id, p?.actor],
    queryFn: ({ pageParam }) => read({ data: { expectedAtlasUserId: id!, acct: p!.acct, actor: p!.actor, ...(pageParam ?? {}) } }),
    initialPageParam: undefined as { accountId: string; max: string } | undefined,
    getNextPageParam: last => (last.accountId && last.next && !last.error ? { accountId: last.accountId, max: last.next } : undefined),
    enabled, staleTime: 60_000,
  });
  const pages = q.data?.pages ?? [];
  const fedizen = pages.flatMap(pg => pg.posts);
  const error = pages[0]?.error;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  const loadMore = useCallback(() => { if (hasNextPage && !isFetchingNextPage) void fetchNextPage(); }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const items = mergeProfilePosts(enabled && !error ? fedizen : [], p?.posts ?? [], !!q.hasNextPage);
  return {
    items, loading: enabled && q.isLoading,
    /** Fedizen couldn't be asked (not connected, not found…): the origin's posts are shown alone. */
    fedizenError: enabled ? error : undefined,
    hasMore: !!q.hasNextPage, loadingMore: q.isFetchingNextPage, moreFailed: !!pages[pages.length - 1]?.error && pages.length > 1,
    loadMore,
  };
}
