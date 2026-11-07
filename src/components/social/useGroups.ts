import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getGroup, getGroups, getLatestInGroups, getMemberships, setGroupMembership } from '@/lib/groups.functions';
import { getFedizenStatus, startFedizenConnect } from '@/lib/fedizen.functions';
import { actionFor, MEMBERSHIP_PROBLEM, type Group, type Membership, type MembershipProblem } from '@/lib/groups';
import { isEmbeddedPreview } from '@/lib/bonfire-auth';
import { RETURN_KEY } from '@/lib/fedizen-feed';
import { useAtlasAuth } from './AuthState';

/** Fedizen's groups directory (public), 100 categories a page, newest first; topics are left out. */
export function useGroupsDirectory() {
  const list = useServerFn(getGroups);
  const q = useInfiniteQuery({
    queryKey: ['fedizen-groups'],
    queryFn: ({ pageParam }) => list({ data: pageParam ? { after: pageParam } : {} }),
    initialPageParam: null as string | null,
    getNextPageParam: last => (last.error ? undefined : last.next ?? undefined),
    staleTime: 5 * 60_000,
  });
  const pages = q.data?.pages ?? [];
  const groups = pages.flatMap(p => p.groups).filter(g => g.type === 'group');
  const failed = q.isError || (pages.length > 0 && !!pages[pages.length - 1].error);
  return { ...q, groups, failed, firstFailed: q.isError || (pages.length === 1 && !!pages[0].error) };
}

/** The latest posts across every group Fedizen knows (public). */
export function useLatestInGroups(enabled = true) {
  const latest = useServerFn(getLatestInGroups);
  return useQuery({ queryKey: ['fedizen-groups-latest'], queryFn: () => latest(), enabled, staleTime: 60_000 });
}

/** One group with its topics and latest posts. */
export function useGroup(id: string | null | undefined) {
  const one = useServerFn(getGroup);
  return useQuery({ queryKey: ['fedizen-group', id], queryFn: () => one({ data: { id: id! } }), enabled: !!id, staleTime: 60_000 });
}

/**
 * Your membership of a group and the action to change it, through your Fedizen connection.
 * `state` says what the button should offer: sign in, connect, reconnect (an older read-only connection),
 * or join / leave / cancel a request.
 */
export function useGroupMembership(g: Group | null | undefined) {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const statusFn = useServerFn(getFedizenStatus), getFn = useServerFn(getMemberships), setFn = useServerFn(setGroupMembership), startFn = useServerFn(startFedizenConnect);
  const [error, setError] = useState<string | null>(null);
  const status = useQuery({ queryKey: ['fedizen-status', user?.id], queryFn: () => statusFn(), enabled: !!user, staleTime: 60_000 });
  const key = ['group-membership', user?.id, g?.id];
  const m = useQuery({ queryKey: key, queryFn: () => getFn({ data: { ids: [g!.id] } }), enabled: !!user && !!g && !!status.data?.connected, staleTime: 30_000 });
  const toggle = useMutation({
    mutationFn: (on: boolean) => setFn({ data: { id: g!.id, action: actionFor(g!), on } }),
    onMutate: () => setError(null),
    onSuccess: r => {
      if (r.ok) qc.setQueryData(key, { ok: true, memberships: { [g!.id]: r.membership } });
      else { setError(MEMBERSHIP_PROBLEM[r.reason]); if (r.reason !== 'failed') void qc.invalidateQueries({ queryKey: ['fedizen-status'] }); }
    },
    onError: () => setError(MEMBERSHIP_PROBLEM.failed),
  });
  const connect = async () => {
    setError(null);
    if (isEmbeddedPreview()) { window.open(`${window.location.origin}/groups${g ? `?group=${g.id}` : ''}`, '_blank', 'noopener'); return; }
    try { sessionStorage.setItem(RETURN_KEY, window.location.pathname + window.location.search); } catch { /* storage unavailable */ }
    const r = await startFn({ data: { origin: window.location.origin } });
    if (r.url) window.location.assign(r.url); else setError(r.error);
  };
  const membership: Membership | undefined = m.data?.ok ? m.data.memberships[g?.id ?? ''] ?? 'none' : undefined;
  const state: MembershipProblem | Membership | 'loading' =
    !user ? 'signed-out'
      : status.isLoading ? 'loading'
      : !status.data?.connected ? 'not-connected'
      : !status.data.canWrite ? 'needs-permission'
      : m.data && !m.data.ok ? (m.data.reason === 'failed' ? 'none' : m.data.reason)
      : membership ?? 'loading';
  return { state, busy: toggle.isPending, error, join: () => toggle.mutate(true), leave: () => toggle.mutate(false), connect };
}
