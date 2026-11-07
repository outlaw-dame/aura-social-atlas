import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Group, GroupPost } from './groups';

const server = () => import('./groups.server');

export type GroupsResult = { groups: Group[]; latest: GroupPost[]; latestError?: 'unavailable'; error?: 'unavailable' };
export type GroupResult = { group: Group; topics: Group[]; posts: GroupPost[]; postsError?: 'unavailable' } | { group: null; error: 'not-found' | 'unavailable' };

/** Fedizen's groups directory and the latest posts across groups. Public, read-only. */
export const getGroups = createServerFn({ method: 'GET' }).handler(async (): Promise<GroupsResult> => {
  const s = await server();
  const [groups, latest] = await Promise.all([s.listGroups(), s.latestInGroups()]);
  if (!groups) return { groups: [], latest: [], error: 'unavailable' };
  return latest ? { groups, latest } : { groups, latest: [], latestError: 'unavailable' };
});

export const getGroup = createServerFn({ method: 'GET' })
  .inputValidator(d => z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }).parse(d))
  .handler(async ({ data }): Promise<GroupResult> => {
    const r = await (await server()).getGroup(data.id);
    return r === null ? { group: null, error: 'unavailable' } : r === 'not-found' ? { group: null, error: 'not-found' } : r;
  });
