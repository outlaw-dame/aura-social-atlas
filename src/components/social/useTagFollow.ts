import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getFollowedTags, setTagFollow } from '@/lib/fedizen.functions';
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
  return useQuery({
    queryKey: key(id),
    queryFn: () => read({ data: { expectedAtlasUserId: id! } }),
    enabled: !!id, staleTime: 5 * 60_000,
  });
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
    const before = qc.getQueryData<FollowedTags>(k);
    const apply = (follow: boolean) => qc.setQueryData<FollowedTags>(k, d => {
      const base = d ?? { tags: [], names: [] };
      const tags = base.tags.filter(t => t !== lower);
      const names = (base.names ?? []).filter(n => n.toLowerCase() !== lower);
      return follow ? { ...base, tags: [lower, ...tags], names: [name, ...names] } : { ...base, tags, names };
    });
    setBusy(lower); setError(null);
    apply(on);
    try {
      const r = await write({ data: { expectedAtlasUserId: uid, tag: name, on } });
      if (!r.ok) { qc.setQueryData(k, before); setError(followProblem(r.error)); return; }
      if (r.following !== on) apply(r.following);
      void qc.invalidateQueries({ queryKey: ['fedizen-foryou', uid] });
    } catch {
      qc.setQueryData(k, before); setError(FOLLOW_PROBLEM.unavailable);
    } finally {
      setBusy(null);
    }
  };
  return { toggle, busy, error, clearError: () => setError(null), signedIn: !!user };
}
