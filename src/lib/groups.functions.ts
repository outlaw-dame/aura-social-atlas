import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { Group, GroupPost, Membership, MembershipProblem } from './groups';

const server = () => import('./groups.server');

export type GroupsResult = { groups: Group[]; latest: GroupPost[]; latestError?: 'unavailable'; error?: 'unavailable' };
export type GroupResult = { group: Group; topics: Group[]; posts: GroupPost[]; postsError?: 'unavailable' } | { group: null; error: 'not-found' | 'unavailable' };

/** Fedizen's groups directory and the latest posts across groups. Public: no sign-in needed. */
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

const groupId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Your membership of these groups (needs a Fedizen connection). */
export const getMemberships = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ ids: z.array(groupId).min(1).max(40) }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; memberships: Record<string, Membership> } | { ok: false; reason: MembershipProblem }> =>
    (await server()).memberships(context.userId, data.ids));

/** Join or leave a group (follow or unfollow, for an announcement channel) as you, on Fedizen. */
export const setGroupMembership = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ id: groupId, action: z.enum(['join', 'follow']), on: z.boolean() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; membership: Membership } | { ok: false; reason: MembershipProblem }> =>
    (await server()).setMembership(context.userId, data.id, data.action, data.on));
