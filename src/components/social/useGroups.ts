import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getGroup, getGroups } from '@/lib/groups.functions';

/** Fedizen's groups directory and the latest posts across groups (public, read-only). */
export function useGroups() {
  const list = useServerFn(getGroups);
  return useQuery({ queryKey: ['fedizen-groups'], queryFn: () => list(), staleTime: 2 * 60_000 });
}

/** One group with its topics and latest posts. */
export function useGroup(id: string | null | undefined) {
  const one = useServerFn(getGroup);
  return useQuery({ queryKey: ['fedizen-group', id], queryFn: () => one({ data: { id: id! } }), enabled: !!id, staleTime: 60_000 });
}
