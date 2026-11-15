import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getFediFollow, getFediProfile, setFediFollow, type FollowState } from '@/lib/fedi-profile.functions';
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
