import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { assertFedizenSessionIntent, hasScope, lookupAcct } from './fedizen-feed';
import type { FediProfile } from './fedi-profile';

/**
 * Fediverse profiles shown inside Atlas. Reading one needs no account: it is the person's public ActivityPub
 * profile. Following goes through the reader's Fedizen connection: Fedizen looks the handle up (fetching the remote
 * account over WebFinger if it hasn't seen it) and sends the Follow.
 */

const target = z.object({
  actor: z.string().url().max(2048).startsWith('https://').optional(),
  acct: z.string().trim().max(320).optional(),
}).refine(v => !!(v.actor || v.acct));

export const getFediProfile = createServerFn({ method: 'GET' })
  .inputValidator(d => target.parse(d))
  .handler(async ({ data }): Promise<{ profile: FediProfile | null }> => {
    const { loadFediProfile } = await import('./fedi-profile.server');
    return { profile: await loadFediProfile(data).catch(() => null) };
  });

type Problem = 'not-connected' | 'needs-permission' | 'expired' | 'unavailable' | 'not-found';
const problem = (status: number): Problem => (status === 401 ? 'expired' : status === 403 ? 'needs-permission' : status === 404 ? 'not-found' : 'unavailable');
const me = z.object({ expectedAtlasUserId: z.string().uuid() });
const acctInput = z.string().trim().min(3).max(320);
export type FollowState = 'following' | 'requested' | 'none';

async function findOnFedizen(token: string, acct: string): Promise<{ id: string } | { error: Problem }> {
  const { fedizenGet } = await import('./fedizen.server');
  const a = lookupAcct(acct);
  if (!a || !a.includes('@')) return { error: 'not-found' };
  const r = await fedizenGet(token, `/api/v1/accounts/lookup?acct=${encodeURIComponent(a)}`);
  const found = r.status === 200 ? (r.data[0] as { id?: string } | undefined) : undefined;
  return found?.id ? { id: found.id } : { error: r.status === 200 ? 'not-found' : problem(r.status) };
}

/** Whether you follow them on Fedizen. */
export const getFediFollow = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ acct: acctInput }).parse(d))
  .handler(async ({ data, context }): Promise<{ state?: FollowState; canWrite: boolean; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { tokenFor, fedizenGet } = await import('./fedizen.server');
    const t = await tokenFor(context.userId);
    if (!t) return { canWrite: false, error: 'not-connected' };
    const canWrite = hasScope(t.scope, 'write');
    const who = await findOnFedizen(t.access_token, data.acct);
    if ('error' in who) return { canWrite, error: who.error };
    const r = await fedizenGet(t.access_token, `/api/v1/accounts/relationships?id%5B%5D=${encodeURIComponent(who.id)}`);
    const rel = r.status === 200 ? (r.data as { id: string; following?: boolean | null; requested?: boolean | null }[]).find(x => x.id === who.id) : undefined;
    if (r.status !== 200) return { canWrite, error: problem(r.status) };
    return { canWrite, state: rel?.following ? 'following' : rel?.requested ? 'requested' : 'none' };
  });

/** Follow or unfollow them from your Fedizen account. */
export const setFediFollow = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ acct: acctInput, on: z.boolean() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; state: FollowState } | { ok: false; error: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { tokenFor, fedizenSend } = await import('./fedizen.server');
    const t = await tokenFor(context.userId);
    if (!t) return { ok: false, error: 'not-connected' };
    if (!hasScope(t.scope, 'write')) return { ok: false, error: 'needs-permission' };
    const who = await findOnFedizen(t.access_token, data.acct);
    if ('error' in who) return { ok: false, error: who.error };
    const r = await fedizenSend(t.access_token, 'POST', `/api/v1/accounts/${who.id}/${data.on ? 'follow' : 'unfollow'}`);
    if (r.status < 200 || r.status >= 300) return { ok: false, error: problem(r.status) };
    const rel = r.data as { following?: boolean | null; requested?: boolean | null } | undefined;
    return { ok: true, state: rel?.following ? 'following' : rel?.requested ? 'requested' : data.on ? 'requested' : 'none' };
  });
