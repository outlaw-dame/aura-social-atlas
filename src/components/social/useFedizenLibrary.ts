import { useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useAtlasAuth } from './AuthState';
import {
  changeFedizenBlock, changeFedizenCircle, changeFedizenCircleMember, getFedizenBlocks, getFedizenCircleMembers, getFedizenCircles, getFedizenSaved, setFedizenSaved,
} from '@/lib/fedizen.functions';
import type { FedizenPost } from '@/lib/fedizen-feed';

/**
 * Saved and Circles, read and written through the person's Fedizen connection:
 * Saved = Bonfire bookmarks (Mastodon /api/v1/bookmarks); Circles = Bonfire circles (served as Mastodon Lists).
 */

export type LibraryProblem = 'not-connected' | 'needs-permission' | 'expired' | 'unavailable' | 'not-found';
export const LIBRARY_PROBLEM: Record<LibraryProblem, string> = {
  'not-connected': 'Connect your Fedizen account to use this.',
  'needs-permission': 'Reconnect Fedizen so Atlas can act for you: save, like, boost and reply to posts, and manage circles.',
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

/**
 * Saved state shared by every view (feed, Profile → Saved, phone and desktop), so a post saved in one shows as saved
 * in all. One request per post at a time: while a post's write is in flight its toggle is disabled, so writes reach
 * Fedizen in the order the person made them and an older reply can't overwrite a newer choice.
 */
type SavedEntry = { saved: boolean; pending: boolean };
const savedStore = (() => {
  let owner: string | undefined;
  let entries = new Map<string, SavedEntry>();
  const listeners = new Set<() => void>();
  const emit = () => { entries = new Map(entries); listeners.forEach(l => l()); };
  return {
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    snapshot: () => entries,
    /** A different signed-in account starts from nothing. */
    own: (userId: string | undefined) => { if (owner !== userId) { owner = userId; entries = new Map(); } },
    /** Writes only while `userId` still owns the store: a reply that lands after an account switch is dropped. */
    set: (userId: string, statusId: string, e: SavedEntry) => { if (owner !== userId) return; entries.set(statusId, e); emit(); },
  };
})();
export const _savedStoreForTests = savedStore;

export function useSaveToggle() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const write = useServerFn(setFedizenSaved);
  savedStore.own(user?.id);
  const entries = useSyncExternalStore(savedStore.subscribe, savedStore.snapshot, savedStore.snapshot);
  const [error, setError] = useState<string | null>(null);
  const isSaved = (p: Pick<FedizenPost, 'statusId' | 'bookmarked'>) => { const e = p.statusId ? entries.get(p.statusId) : undefined; return e ? e.saved : !!p.bookmarked; };
  const isPending = (p: Pick<FedizenPost, 'statusId'>) => !!(p.statusId && entries.get(p.statusId)?.pending);
  const toggle = async (p: Pick<FedizenPost, 'statusId' | 'bookmarked'>) => {
    if (!user || !p.statusId || isPending(p)) return;
    const id = p.statusId, was = isSaved(p), on = !was;
    setError(null);
    const uid = user.id;
    savedStore.set(uid, id, { saved: on, pending: true });
    try {
      const r = await write({ data: { expectedAtlasUserId: uid, statusId: id, on } });
      if (!r.ok) { savedStore.set(uid, id, { saved: was, pending: false }); setError(LIBRARY_PROBLEM[r.error]); return; }
      savedStore.set(uid, id, { saved: r.saved, pending: false });
      void qc.invalidateQueries({ queryKey: ['fedizen-saved'] });
      void qc.invalidateQueries({ queryKey: ['fedizen-home'] });
    } catch {
      savedStore.set(uid, id, { saved: was, pending: false });
      setError(LIBRARY_PROBLEM.unavailable);
    }
  };
  return { isSaved, isPending, toggle, error, canSave: !!user };
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

/** People you block on Fedizen (Settings → Moderation). */
export function useFedizenBlocks(enabled = true) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getFedizenBlocks);
  const id = user?.id;
  return useQuery({
    queryKey: ['fedizen-blocks', id],
    queryFn: () => { if (!id) throw new Error('Atlas user is not signed in.'); return read({ data: { expectedAtlasUserId: id } }); },
    enabled: !!id && enabled,
  });
}

/** Block by handle or unblock by account id; resolves to an error message or null. */
export function useBlockActions() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const change = useServerFn(changeFedizenBlock);
  const run = useMutation({
    mutationFn: async (d: { block?: string; unblock?: string }) => {
      if (!user) return LIBRARY_PROBLEM['not-connected'];
      try {
        const r = await change({ data: { expectedAtlasUserId: user.id, ...d } });
        if (!r.ok) return LIBRARY_PROBLEM[r.error];
        // The block changes what the feeds may show: refresh the list and every personal feed holding their posts.
        await Promise.all(['fedizen-blocks', 'fedizen-home', 'bonfire-native-home', 'fedizen-messages', 'fedizen-saved']
          .map(k => qc.invalidateQueries({ queryKey: [k] })));
        return null;
      } catch { return LIBRARY_PROBLEM.unavailable; }
    },
  });
  return { busy: run.isPending, block: (handle: string) => run.mutateAsync({ block: handle }), unblock: (id: string) => run.mutateAsync({ unblock: id }) };
}
