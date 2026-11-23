import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useAtlasAuth } from './AuthState';
import { useStrictSpotlightFilters } from './useIntelligence';
import { getSpotlight, getSpotlightModeration, getViewerSpotlight } from '@/lib/spotlight.functions';
import { combineSpotlight, type SpotlightItem } from '@/lib/spotlight';
import { allowedSpotlightItem, spotlightFilterPost } from '@/lib/spotlight-curation';

/** Both Atlas desktop and phone use the same fail-closed personalized
 * projection. No global query cache ever contains a personalized verdict.
 */
export function useCuratedSpotlight(): {
  items: SpotlightItem[];
  loading: boolean;
  unavailable: boolean;
} {
  const { user } = useAtlasAuth();
  const viewerFn = useServerFn(getViewerSpotlight);
  const moderationFn = useServerFn(getSpotlightModeration);
  const identity = user?.id;

  const shared = useQuery({
    queryKey: ['spotlight'],
    queryFn: () => getSpotlight(),
    enabled: !!identity,
    staleTime: 5 * 60_000,
  });
  const moderation = useQuery({
    queryKey: ['spotlight-moderation', identity],
    queryFn: () => {
      if (!identity) throw new Error('No active Atlas session');
      return moderationFn({ data: { expectedAtlasUserId: identity } });
    },
    enabled: !!identity, staleTime: 30_000, retry: false,
    refetchOnWindowFocus: 'always', refetchInterval: 2 * 60_000,
  });
  const viewer = useQuery({
    queryKey: ['spotlight-viewer', identity],
    queryFn: () => {
      if (!identity) throw new Error('No active Atlas session');
      return viewerFn({ data: { expectedAtlasUserId: identity } });
    },
    enabled: !!identity && moderation.data?.moderation != null,
    staleTime: 30_000, retry: false, refetchOnWindowFocus: true,
  });

  // Never display with a snapshot that is currently being rechecked.
  const policy = moderation.isFetching ? null : moderation.data?.moderation;
  const candidates = useMemo(() => {
    if (!identity || !policy) return [];
    const base = shared.data?.items ?? [];
    const all = combineSpotlight(
      base.filter(item => item.reason === 'trending'),
      viewer.data ?? [],
      base.filter(item => item.reason !== 'trending'),
    );
    return all.filter(item => allowedSpotlightItem(item, policy));
  }, [identity, policy, shared.data, viewer.data]);
  const filterable = useMemo(() => candidates.map(spotlightFilterPost), [candidates]);
  const cleared = useStrictSpotlightFilters(filterable);
  const items = useMemo(() => candidates.filter(item => cleared.has(item.id)), [candidates, cleared]);
  return {
    items,
    loading: !!identity && (shared.isLoading || moderation.isFetching || viewer.isLoading),
    unavailable: !identity || moderation.isError || (!!moderation.data && !moderation.data.moderation),
  };
}
