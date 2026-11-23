import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useAtlasAuth } from './AuthState';
import { useStrictSpotlightFilters } from './useIntelligence';
import { getSpotlight, getViewerSpotlight } from '@/lib/spotlight.functions';
import { combineSpotlight, type SpotlightItem } from '@/lib/spotlight';
import { allowedSpotlightItem, spotlightFilterPost } from '@/lib/spotlight-curation';

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
  const viewer = useQuery({
    queryKey: ['spotlight-viewer', identity],
    queryFn: () => {
      if (!identity) throw new Error('No active Atlas session');
      return viewerFn({ data: { expectedAtlasUserId: identity } });
    },
    enabled: !!identity, staleTime: 30_000, retry: false,
    refetchOnWindowFocus: 'always', refetchInterval: 2 * 60_000,
  });

  // Never trust an old snapshot during a moderation refresh. An API error,
  // stale session or failed block/mute read can't be treated as no blocks.
  const policy = viewer.isFetching ? null : viewer.data?.moderation;
  const candidates = useMemo(() => {
    if (!identity || !policy) return [];
    const base = shared.data?.items ?? [];
    const all = combineSpotlight(
      base.filter(item => item.reason === 'trending'),
      viewer.data?.items ?? [],
      base.filter(item => item.reason !== 'trending'),
    );
    return all.filter(item => allowedSpotlightItem(item, policy));
  }, [identity, policy, shared.data, viewer.data]);
  const filterable = useMemo(() => candidates.map(spotlightFilterPost), [candidates]);
  const cleared = useStrictSpotlightFilters(filterable);
  const items = useMemo(() => candidates.filter(item => cleared.has(item.id)), [candidates, cleared]);
  return {
    items,
    loading: !!identity && (shared.isLoading || viewer.isFetching),
    unavailable: !identity || viewer.isError || (!!viewer.data && !viewer.data.moderation),
  };
}
