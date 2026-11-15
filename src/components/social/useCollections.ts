import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useAtlasAuth } from './AuthState';
import { getMyCollections } from '@/lib/collections.functions';

/** The signed-in person's collections. */
export function useMyCollections() {
  const { user } = useAtlasAuth();
  const list = useServerFn(getMyCollections);
  return useQuery({ queryKey: ['my-collections', user?.id], queryFn: () => list(), enabled: !!user, staleTime: 30_000 });
}
