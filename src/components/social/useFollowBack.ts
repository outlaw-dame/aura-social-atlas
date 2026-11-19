import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { followFedizenAccount } from '@/lib/fedizen.functions';
import type { FediPerson } from '@/lib/fedizen-feed';
import { useAtlasAuth } from './AuthState';
import { useFollowedAmong } from './useIntelligence';
import { FOLLOW_PROBLEM } from './useFediProfile';

type Person = FediPerson & { id?: string };

/**
 * Follow someone from Activity: "Follow back" for a new follower, "Follow" for anyone else in a group, as Bluesky and
 * Mastodon's apps offer in a follow notification. Whether you already follow them comes from Fedizen's relationships
 * (useFollowedAmong, batched with every other check); the button only shows once that's known.
 */
export function useFollowBack(p: Person) {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const write = useServerFn(followFedizenAccount);
  const known = useFollowedAmong(p.id ? [p.id] : []);
  const [state, setState] = useState<'following' | 'requested' | 'none' | null>(null);
  const m = useMutation({
    mutationFn: (on: boolean) => write({ data: { expectedAtlasUserId: user!.id, accountId: p.id!, on } }),
    onSuccess: r => {
      if (!r.ok) return;
      setState(r.state);
      void qc.invalidateQueries({ queryKey: ['fedizen-home'] });
      void qc.invalidateQueries({ queryKey: ['fedi-follow', user?.id, p.acct] });
    },
  });
  const now = state ?? (p.id && known.has(p.id) ? 'following' : 'none');
  const error = m.data && !m.data.ok ? FOLLOW_PROBLEM[m.data.error] : m.isError ? FOLLOW_PROBLEM.unavailable : null;
  return {
    can: !!user && !!p.id, state: now, busy: m.isPending, error,
    toggle: () => m.mutate(now === 'none'),
  };
}
