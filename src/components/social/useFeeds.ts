import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getCircleFeed, getForYou } from '@/lib/fedizen.functions';
import { useAtlasAuth } from './AuthState';

/** For You, read through the person's Fedizen connection. */
export function useForYou(enabled: boolean) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getForYou);
  const id = user?.id;
  return useQuery({
    queryKey: ['fedizen-foryou', id],
    queryFn: () => { if (!id) throw new Error('Atlas user is not signed in.'); return read({ data: { expectedAtlasUserId: id } }); },
    enabled: !!id && enabled, staleTime: 60_000,
  });
}

/** A pinned circle's feed. */
export function useCircleFeed(circleId: string | null) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getCircleFeed);
  const id = user?.id;
  return useQuery({
    queryKey: ['fedizen-circle-feed', id, circleId],
    queryFn: () => { if (!id || !circleId) throw new Error('Nothing to read.'); return read({ data: { expectedAtlasUserId: id, id: circleId } }); },
    enabled: !!id && !!circleId, staleTime: 60_000,
  });
}

export const FEED_PROBLEM = {
  'not-connected': 'Connect your Fedizen account to see this feed.',
  'needs-permission': 'Reconnect Fedizen so Atlas can read this feed.',
  expired: 'Fedizen ended Atlas’s access. Connect again to keep reading.',
  unavailable: 'Fedizen couldn’t send this feed right now.',
  'not-found': 'This circle no longer exists on Fedizen.',
} as const;
