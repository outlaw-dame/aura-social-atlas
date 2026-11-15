import { useState, useSyncExternalStore } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { useAtlasAuth } from './AuthState';
import { LIBRARY_PROBLEM } from './useFedizenLibrary';
import { replyOnFedizen, setFedizenReaction } from '@/lib/fedizen.functions';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { replyVisibility } from '@/lib/post-actions';

export { AUDIENCE_LABEL, compactCount, replyMention, replyVisibility } from '@/lib/post-actions';

/**
 * Like and boost, shared by every view (phone and desktop, every feed), so a post liked in one shows as liked in all.
 * Like Save, one write per post and kind at a time: while it's in flight that button is disabled, so writes reach
 * Fedizen in the order the person made them. The count moves with the tap and settles on what Fedizen answers.
 */
type Kind = 'like' | 'boost';
type Entry = { on: boolean; count: number; pending: boolean };
const store = (() => {
  let owner: string | undefined;
  let entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const emit = () => { entries = new Map(entries); listeners.forEach(l => l()); };
  return {
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    snapshot: () => entries,
    own: (userId: string | undefined) => { if (owner !== userId) { owner = userId; entries = new Map(); } },
    set: (key: string, e: Entry) => { entries.set(key, e); emit(); },
  };
})();
export const _reactionStoreForTests = store;
const keyOf = (statusId: string, kind: Kind) => `${kind}:${statusId}`;

type Post = Pick<FedizenPost, 'statusId' | 'liked' | 'boosted' | 'counts'>;

export function useReactions() {
  const { user } = useAtlasAuth();
  const write = useServerFn(setFedizenReaction);
  store.own(user?.id);
  const entries = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const [error, setError] = useState<string | null>(null);
  const base = (p: Post, kind: Kind): Entry => ({
    on: kind === 'like' ? !!p.liked : !!p.boosted,
    count: (kind === 'like' ? p.counts?.likes : p.counts?.boosts) ?? 0,
    pending: false,
  });
  const state = (p: Post, kind: Kind): Entry => (p.statusId ? entries.get(keyOf(p.statusId, kind)) : undefined) ?? base(p, kind);
  const toggle = async (p: Post, kind: Kind) => {
    if (!user || !p.statusId) return;
    const k = keyOf(p.statusId, kind), was = state(p, kind);
    if (was.pending) return;
    const on = !was.on;
    setError(null);
    store.set(k, { on, count: Math.max(0, was.count + (on ? 1 : -1)), pending: true });
    try {
      const r = await write({ data: { expectedAtlasUserId: user.id, statusId: p.statusId, kind, on } });
      if (!r.ok) { store.set(k, { ...was, pending: false }); setError(LIBRARY_PROBLEM[r.error]); return; }
      store.set(k, { on: r.on, count: r.count ?? Math.max(0, was.count + (r.on === was.on ? 0 : r.on ? 1 : -1)), pending: false });
    } catch {
      store.set(k, { ...was, pending: false });
      setError(LIBRARY_PROBLEM.unavailable);
    }
  };
  return { state, toggle, error, canAct: !!user };
}

export function useReply() {
  const { user } = useAtlasAuth();
  const send = useServerFn(replyOnFedizen);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reply = async (p: Pick<FedizenPost, 'statusId' | 'visibility' | 'id'>, text: string): Promise<{ url?: string } | null> => {
    if (!user || !p.statusId || !text.trim() || sending) return null;
    setSending(true); setError(null);
    try {
      const r = await send({ data: { expectedAtlasUserId: user.id, statusId: p.statusId, text: text.trim().slice(0, 5000), visibility: replyVisibility(p) } });
      if (!r.ok) { setError(LIBRARY_PROBLEM[r.error]); return null; }
      return { url: r.url };
    } catch { setError(LIBRARY_PROBLEM.unavailable); return null; } finally { setSending(false); }
  };
  return { reply, sending, error, clearError: () => setError(null), canReply: !!user };
}

/** Share a post's link: the system share sheet where there is one, else copy it. Resolves to 'copied' or 'shared'. */
export async function sharePost(p: Pick<FedizenPost, 'url' | 'author'>): Promise<'shared' | 'copied' | null> {
  try {
    if (typeof navigator !== 'undefined' && navigator.share) { await navigator.share({ title: `Post by ${p.author}`, url: p.url }); return 'shared'; }
    await navigator.clipboard.writeText(p.url);
    return 'copied';
  } catch { return null; }
}
