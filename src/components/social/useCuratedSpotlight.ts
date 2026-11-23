import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useAtlasAuth } from './AuthState';
import { useStrictSpotlightFilters } from './useIntelligence';
import { getSpotlight, getSpotlightTrends, getViewerSpotlight } from '@/lib/spotlight.functions';
import type { SpotlightItem } from '@/lib/spotlight';
import { selectModeratedSpotlight, spotlightFilterPost } from '@/lib/spotlight-curation';

/** Both Atlas desktop and phone reuse ONE owner-bound moderation snapshot
 * returned atomically with the sampled federated content. No public cache may
 * contain a user policy or private bearer; moderator failure means zero cards.
 */
export function useCuratedSpotlight(): {
  items: SpotlightItem[];
  loading: boolean;
  unavailable: boolean;
} {
  const { user } = useAtlasAuth();
  const viewerFn = useServerFn(getViewerSpotlight);
  const identity = user?.id;

  const shared = useQuery({
    queryKey: ['spotlight'],
    queryFn: () => getSpotlight(),
    enabled: !!identity,
    staleTime: 5 * 60_000,
  });
  const trends = useQuery({
    queryKey: ['spotlight-trends'],
    queryFn: () => getSpotlightTrends(),
    enabled: !!identity,
    staleTime: 60_000,
  });
  const viewer = useQuery({
    queryKey: ['spotlight-viewer', identity],
    queryFn: () => {
      if (!identity) throw new Error('No active Atlas session');
      return viewerFn({ data: { expectedAtlasUserId: identity } });
    },
    enabled: !!identity, staleTime: 30_000, retry: false,
    refetchOnWindowFocus: 'always', refetchInterval: 2 * 60_000,
  });

  // Continue using the last *successfully validated* owner-scoped policy
  // during ordinary background refreshes. Local block/mute writes immediately
  // clear this query's policy in useFedizenLibrary/useOwnPosts; a failed read
  // or changed account still fails closed. Never share policies across users.
  const policy = viewer.isError ? null : viewer.data?.moderation;
  const candidates = useMemo(() => {
    if (!identity || !policy) return [];
    const base = [...(trends.data?.items ?? []), ...(shared.data?.items ?? [])];
    return selectModeratedSpotlight(base, viewer.data?.items ?? [], policy);
  }, [identity, policy, trends.data, shared.data, viewer.data]);
  const filterable = useMemo(() => candidates.map(spotlightFilterPost), [candidates]);
  const cleared = useStrictSpotlightFilters(filterable);
  const items = useMemo(() => candidates.filter(item => cleared.has(item.id)), [candidates, cleared]);
  return {
    items,
    // A slow public source or a policy refresh must not mask already-cleared
    // owner-bound results. Only the cold start needs a loading placeholder.
    loading: !!identity && !items.length &&
      ((!viewer.data && viewer.isPending) || (!shared.data && shared.isPending) ||
        (!trends.data && trends.isPending)),
    unavailable: !identity || viewer.isError || (!!viewer.data && !viewer.data.moderation),
  };
}
