import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useAtlasAuth } from './AuthState';
import {
  changeFedizenCircle, changeFedizenCircleMember, getFedizenCircleMembers, getFedizenCircles, getFedizenSaved, setFedizenSaved,
} from '@/lib/fedizen.functions';
import type { FedizenPost } from '@/lib/fedizen-feed';

/**
 * Saved and Circles, read and written through the person's Fedizen connection:
 * Saved = Bonfire bookmarks (Mastodon /api/v1/bookmarks); Circles = Bonfire circles (served as Mastodon Lists).
 */

export type LibraryProblem = 'not-connected' | 'needs-permission' | 'expired' | 'unavailable' | 'not-found';
export const LIBRARY_PROBLEM: Record<LibraryProblem, string> = {
  'not-connected': 'Connect your Fedizen account to use this.',
  'needs-permission': 'Reconnect Fedizen so Atlas can save posts and manage circles for you.',
  expired: 'Fedizen ended Atlas’s access. Connect again to continue.',
  unavailable: 'Fedizen couldn’t do that right now. Try again.',
  'not-found': 'No one with that handle was found on Fedizen.',
};

export function useFedizenSaved(enabled = true) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getFedizenSaved);
  const id = user?.id;
  return useQuery({
    queryKey: ['fedizen-saved', id],
    queryFn: () => { if (!id) throw new Error('Atlas user is not signed in.'); return read({ data: { expectedAtlasUserId: id } }); },
    enabled: !!id && enabled, staleTime: 30_000,
  });
}

/** Bookmark toggle for Fedizen posts, optimistic: the button changes at once and goes back if Fedizen says no. */
export function useSaveToggle() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const write = useServerFn(setFedizenSaved);
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const isSaved = (p: Pick<FedizenPost, 'statusId' | 'bookmarked'>) => (p.statusId && p.statusId in override ? override[p.statusId] : !!p.bookmarked);
  const toggle = async (p: Pick<FedizenPost, 'statusId' | 'bookmarked'>) => {
    if (!user || !p.statusId) return;
    const on = !isSaved(p);
    setError(null);
    setOverride(o => ({ ...o, [p.statusId!]: on }));
    try {
      const r = await write({ data: { expectedAtlasUserId: user.id, statusId: p.statusId, on } });
      if (!r.ok) { setOverride(o => ({ ...o, [p.statusId!]: !on })); setError(LIBRARY_PROBLEM[r.error]); return; }
      setOverride(o => ({ ...o, [p.statusId!]: r.saved }));
      void qc.invalidateQueries({ queryKey: ['fedizen-saved'] });
    } catch {
      setOverride(o => ({ ...o, [p.statusId!]: !on }));
      setError(LIBRARY_PROBLEM.unavailable);
    }
  };
  return { isSaved, toggle, error, canSave: !!user };
}

export function useFedizenCircles(enabled = true) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getFedizenCircles);
  const id = user?.id;
  return useQuery({
    queryKey: ['fedizen-circles', id],
    queryFn: () => { if (!id) throw new Error('Atlas user is not signed in.'); return read({ data: { expectedAtlasUserId: id } }); },
    enabled: !!id && enabled, staleTime: 30_000,
  });
}

export function useCircleMembers(circleId: string | null) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getFedizenCircleMembers);
  const id = user?.id;
  return useQuery({
    queryKey: ['fedizen-circle', id, circleId],
    queryFn: () => { if (!id || !circleId) throw new Error('Nothing to read.'); return read({ data: { expectedAtlasUserId: id, id: circleId } }); },
    enabled: !!id && !!circleId,
  });
}

/** Create, rename or delete a circle; add or remove its members. Each resolves to an error message or null. */
export function useCircleActions() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const circle = useServerFn(changeFedizenCircle), member = useServerFn(changeFedizenCircleMember);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['fedizen-circles'] }), qc.invalidateQueries({ queryKey: ['fedizen-circle'] })]);
  const run = useMutation({
    mutationFn: async (fn: (uid: string) => Promise<{ ok: boolean; error?: LibraryProblem }>) => {
      if (!user) return LIBRARY_PROBLEM['not-connected'];
      try { const r = await fn(user.id); if (!r.ok) return LIBRARY_PROBLEM[r.error ?? 'unavailable']; await refresh(); return null; }
      catch { return LIBRARY_PROBLEM.unavailable; }
    },
  });
  return {
    busy: run.isPending,
    create: (title: string) => run.mutateAsync(uid => circle({ data: { expectedAtlasUserId: uid, action: 'create', title } })),
    rename: (id: string, title: string) => run.mutateAsync(uid => circle({ data: { expectedAtlasUserId: uid, action: 'rename', id, title } })),
    remove: (id: string) => run.mutateAsync(uid => circle({ data: { expectedAtlasUserId: uid, action: 'delete', id } })),
    addMember: (id: string, handle: string) => run.mutateAsync(uid => member({ data: { expectedAtlasUserId: uid, id, add: handle } })),
    removeMember: (id: string, accountId: string) => run.mutateAsync(uid => member({ data: { expectedAtlasUserId: uid, id, remove: accountId } })),
  };
}
