import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getFollowedTags, setTagFollow, syncTagRelays } from '@/lib/fedizen.functions';
import { useAtlasAuth } from './AuthState';

const FOLLOW_PROBLEM: Record<string, string> = {
  'not-connected': 'Connect Fedizen to follow hashtags.',
  'needs-permission': 'Reconnect Fedizen so Atlas can follow hashtags for you.',
  expired: 'Fedizen ended Atlas’s access. Connect again to follow hashtags.',
  unavailable: 'Fedizen couldn’t update this hashtag. Try again.',
};
const followProblem = (e: string) => FOLLOW_PROBLEM[e] ?? FOLLOW_PROBLEM.unavailable;

type FollowedTags = Awaited<ReturnType<typeof getFollowedTags>>;
const key = (id: string | undefined) => ['fedizen-followed-tags', id] as const;

/** The hashtags the person follows on Fedizen, as names to list (Settings → Followed hashtags). */
export function useFollowedTagList() {
  const { user } = useAtlasAuth();
  const read = useServerFn(getFollowedTags);
  const id = user?.id;
  const q = useQuery({
    queryKey: key(id),
    queryFn: () => read({ data: { expectedAtlasUserId: id! } }),
    // A failed read isn't kept: the next view asks Fedizen again.
    enabled: !!id, staleTime: q => (q.state.data?.error ? 0 : 5 * 60_000),
  });
  useTagRelaySync(id, !!q.data?.tags.length);
  return q;
}

/**
 * Hashtags followed before Atlas followed their FediBuzz relays get them once per session (syncTagRelays: only those
 * missing, up to 10 a time), so every followed hashtag brings in posts from across the fediverse.
 */
function useTagRelaySync(id: string | undefined, hasTags: boolean) {
  const sync = useServerFn(syncTagRelays);
  const qc = useQueryClient();
  useEffect(() => {
    if (!id || !hasTags) return;
    const flag = `atlas-tag-relays-synced:${id}`;
    try { if (sessionStorage.getItem(flag)) return; sessionStorage.setItem(flag, '1'); } catch { /* storage blocked: sync anyway */ }
    void sync({ data: { expectedAtlasUserId: id } }).then(r => {
      if (r.followed) void qc.invalidateQueries({ queryKey: ['fedizen-relay-follows', id] });
    }).catch(() => undefined);
  }, [id, hasTags, sync, qc]);
}

/**
 * Follow a hashtag the way Mastodon offers it: one button on the tag's page (and Unfollow in the list of followed
 * hashtags). The followed list updates at once and For You is refreshed, since it reads the hashtags you follow. The
 * write is bound to the account that started it, so switching accounts mid-request can't touch the next one's list.
 */
export function useTagFollow() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const write = useServerFn(setTagFollow);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toggle = async (tag: string, on: boolean) => {
    const uid = user?.id;
    if (!uid || busy) return;
    const name = tag.replace(/^#/, '');
    const lower = name.toLowerCase();
    const k = key(uid);
    setBusy(lower); setError(null);
    // A read of the list still in flight would land after the change below and undo it: stop it first.
    await qc.cancelQueries({ queryKey: k });
    const before = qc.getQueryData<FollowedTags>(k);
    const apply = (follow: boolean) => qc.setQueryData<FollowedTags>(k, d => {
      const base = d ?? { tags: [], names: [] };
      const tags = base.tags.filter(t => t !== lower);
      const names = (base.names ?? []).filter(n => n.toLowerCase() !== lower);
      return follow ? { ...base, tags: [lower, ...tags], names: [name, ...names] } : { ...base, tags, names };
    });
    apply(on);
    try {
      const r = await write({ data: { expectedAtlasUserId: uid, tag: name, on } });
      if (!r.ok) { qc.setQueryData(k, before); setError(followProblem(r.error)); void qc.invalidateQueries({ queryKey: k }); return; }
      if (r.following !== on) apply(r.following);
      // Reconcile with Fedizen's own list (and For You, which reads it) now that the write has settled.
      void qc.invalidateQueries({ queryKey: k });
      void qc.invalidateQueries({ queryKey: ['fedizen-foryou', uid] });
      // The tag's FediBuzz relay was followed (or unfollowed) with it, on the server.
      void qc.invalidateQueries({ queryKey: ['fedizen-relay-follows', uid] });
    } catch {
      qc.setQueryData(k, before); setError(FOLLOW_PROBLEM.unavailable);
      void qc.invalidateQueries({ queryKey: k });
    } finally {
      setBusy(null);
    }
  };
  return { toggle, busy, error, clearError: () => setError(null), signedIn: !!user };
}

/**
 * Whether the person follows one tag, and whether that is known yet. Until Fedizen's list has arrived the answer is
 * unknown, so the Follow button waits rather than guessing "Follow" for a tag already followed; if the list can't be
 * read, `failed` says so and `retry` asks again.
 */
export function useTagFollowState(tag: string | null) {
  const q = useFollowedTagList();
  const known = !!q.data && !q.data.error && !q.isError;
  return {
    known,
    following: known && !!tag && q.data!.tags.includes(tag.toLowerCase()),
    failed: !q.isLoading && !known,
    retry: () => void q.refetch(),
  };
}
