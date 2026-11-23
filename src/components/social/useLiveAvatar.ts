import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getActorAvatar } from '@/lib/fedi-profile.functions';
import { useAtlasAuth } from './AuthState';

/** Pictures that failed to load in this tab, so every row showing the same dead picture skips it at once. */
const dead = new Set<string>();

/**
 * An account's avatar that recovers when Fedizen's copy is missing or gone: servers move or delete old pictures and
 * Fedizen keeps the old address, and for some remote accounts (Lemmy users, often) Fedizen never stored one and sends
 * its placeholder, which Atlas drops. Either way the account's current picture is read from its actor (once per
 * account, shared by every row through the query cache); when that fails too, or there is none, `src` is undefined
 * and the caller shows the initial.
 */
export function useLiveAvatar(avatar: string | undefined, actor: string | undefined) {
  const { user } = useAtlasAuth();
  const [, setFailures] = useState(0);
  const read = useServerFn(getActorAvatar);
  const needFresh = (!avatar || dead.has(avatar)) && !!actor && actor.startsWith('https://') && !!user;
  const fresh = useQuery({
    queryKey: ['actor-avatar', actor],
    queryFn: () => read({ data: { actor: actor! } }),
    enabled: needFresh, staleTime: 6 * 3600_000, retry: false,
  });
  const src = [avatar, fresh.data?.avatar ?? undefined].find((u): u is string => !!u && !dead.has(u));
  return { src, onError: () => { if (src) { dead.add(src); setFailures(n => n + 1); } } };
}
