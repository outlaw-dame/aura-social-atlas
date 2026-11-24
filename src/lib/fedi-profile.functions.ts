import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { assertFedizenSessionIntent, hasScope, lookupAcct } from './fedizen-feed';
import type { FediProfile, FediProfilePost } from './fedi-profile';
import type { FedizenPost } from './fedizen-feed';

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

type Problem = 'not-connected' | 'needs-permission' | 'expired' | 'unavailable' | 'not-found' | 'unverified';
const problem = (status: number): Problem => (status === 401 ? 'expired' : status === 403 ? 'needs-permission' : status === 404 ? 'not-found' : 'unavailable');
const me = z.object({ expectedAtlasUserId: z.string().uuid() });
const acctInput = z.string().trim().min(3).max(320);
const actorInput = z.string().url().max(2048).startsWith('https://');
export type FollowState = 'following' | 'requested' | 'none';

/**
 * Fedizen follows a handle, so the handle must belong to the profile on screen: its server's WebFinger has to name
 * this same actor. Otherwise a profile claiming someone else's handle would follow (or show) the wrong person.
 */
async function findOnFedizen(token: string, acct: string, actor: string): Promise<{ id: string } | { error: Problem }> {
  const [{ fedizenGet }, { webfingerActor }] = await Promise.all([import('./fedizen.server'), import('./fedi-profile.server')]);
  if ((await webfingerActor(acct).catch(() => null)) !== actor) return { error: 'unverified' };
  const a = lookupAcct(acct);
  if (!a || !a.includes('@')) return { error: 'not-found' };
  const r = await fedizenGet(token, `/api/v1/accounts/lookup?acct=${encodeURIComponent(a)}`);
  const found = r.status === 200 ? (r.data[0] as { id?: string } | undefined) : undefined;
  return found?.id ? { id: found.id } : { error: r.status === 200 ? 'not-found' : problem(r.status) };
}

/** Whether you follow them on Fedizen. */
export const getFediFollow = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ acct: acctInput, actor: actorInput }).parse(d))
  .handler(async ({ data, context }): Promise<{ state?: FollowState; canWrite: boolean; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { tokenFor, fedizenGet } = await import('./fedizen.server');
    const t = await tokenFor(context.userId);
    if (!t) return { canWrite: false, error: 'not-connected' };
    const canWrite = hasScope(t.scope, 'write');
    const who = await findOnFedizen(t.access_token, data.acct, data.actor);
    if ('error' in who) return { canWrite, error: who.error };
    const r = await fedizenGet(t.access_token, `/api/v1/accounts/relationships?id%5B%5D=${encodeURIComponent(who.id)}`);
    const rel = r.status === 200 ? (r.data as { id: string; following?: boolean | null; requested?: boolean | null }[]).find(x => x.id === who.id) : undefined;
    if (r.status !== 200) return { canWrite, error: problem(r.status) };
    return { canWrite, state: rel?.following ? 'following' : rel?.requested ? 'requested' : 'none' };
  });

/** Follow or unfollow them from your Fedizen account. */
export const setFediFollow = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ acct: acctInput, actor: actorInput, on: z.boolean() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; state: FollowState } | { ok: false; error: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { tokenFor, fedizenSend } = await import('./fedizen.server');
    const t = await tokenFor(context.userId);
    if (!t) return { ok: false, error: 'not-connected' };
    if (!hasScope(t.scope, 'write')) return { ok: false, error: 'needs-permission' };
    const who = await findOnFedizen(t.access_token, data.acct, data.actor);
    if ('error' in who) return { ok: false, error: who.error };
    const r = await fedizenSend(t.access_token, 'POST', `/api/v1/accounts/${who.id}/${data.on ? 'follow' : 'unfollow'}`);
    if (r.status < 200 || r.status >= 300) return { ok: false, error: problem(r.status) };
    const rel = r.data as { following?: boolean | null; requested?: boolean | null } | undefined;
    return { ok: true, state: rel?.following ? 'following' : rel?.requested ? 'requested' : data.on ? 'requested' : 'none' };
  });

/**
 * Which of your circles they're in (Mastodon /api/v1/accounts/:id/lists; Bonfire `circles_containing_subject`), with
 * their Fedizen account id, which adding and removing them goes by (changeFedizenCircleMember).
 */
export const getFediCircles = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ acct: acctInput, actor: actorInput }).parse(d))
  .handler(async ({ data, context }): Promise<{ accountId?: string; ids: string[]; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { tokenFor, fedizenGet } = await import('./fedizen.server');
    const { fromLists } = await import('./fedizen-feed');
    const t = await tokenFor(context.userId);
    if (!t) return { ids: [], error: 'not-connected' };
    const who = await findOnFedizen(t.access_token, data.acct, data.actor);
    if ('error' in who) return { ids: [], error: who.error };
    const r = await fedizenGet(t.access_token, `/api/v1/accounts/${who.id}/lists`);
    return r.status === 200 ? { accountId: who.id, ids: fromLists(r.data as never).map(l => l.id) } : { accountId: who.id, ids: [], error: problem(r.status) };
  });

/**
 * The avatar an account publishes now (its actor's `icon`), for when the copy Fedizen keeps no longer loads: servers
 * move or delete old pictures, and Fedizen keeps pointing at them. Read through the guarded fetch and cached on the
 * server (feed-enrich.server actorAvatars); null when the actor gives none.
 */
export const getActorAvatar = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ actor: actorInput }).strict().parse(d))
  .handler(async ({ data }): Promise<{ avatar: string | null }> => {
    const { actorAvatars } = await import('./feed-enrich.server');
    const found = await actorAvatars([data.actor], 4000).catch(() => new Map<string, string>());
    return { avatar: found.get(data.actor) ?? null };
  });

/**
 * Someone's posts as the reader's Fedizen has them, so each can be liked, boosted, replied to and saved: the handle is
 * confirmed against the profile's actor first (as Follow does), then their statuses are read through the reader's
 * connection, newest first, 20 at a time. Fedizen only has what reached it, so a profile also shows the newest posts
 * from the account's own server that Fedizen hasn't received yet (useProfilePosts). Older pages pass the Fedizen id
 * this returned and the cursor.
 */
export const getProfilePosts = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({
    acct: acctInput, actor: actorInput,
    accountId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(), max: z.string().min(1).max(512).optional(),
  }).parse(d))
  .handler(async ({ data, context }): Promise<{ posts: FedizenPost[]; accountId?: string; next?: string; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const [{ tokenFor, fedizenGet, PAGE_CURSOR }, { fromStatuses }, { withArticleAuthors }] = await Promise.all([import('./fedizen.server'), import('./fedizen-feed'), import('./feed-enrich.server')]);
    const t = await tokenFor(context.userId);
    if (!t) return { posts: [], error: 'not-connected' };
    let id = data.accountId;
    if (!id) {
      const who = await findOnFedizen(t.access_token, data.acct, data.actor).catch(() => ({ error: 'unavailable' as const }));
      if ('error' in who) return { posts: [], error: who.error };
      id = who.id;
    }
    // The cursor is Fedizen's own (from its Link header), sent back exactly as the home timeline's is.
    const cursor = data.max ? encodeURIComponent(data.max) : undefined;
    if (cursor && !PAGE_CURSOR.test(cursor)) return { posts: [], accountId: id, error: 'unavailable' };
    const r = await fedizenGet(t.access_token, `/api/v1/accounts/${encodeURIComponent(id)}/statuses?limit=20${cursor ? `&max_id=${cursor}` : ''}`).catch(() => null);
    if (!r || r.status !== 200) return { posts: [], accountId: id, error: r ? problem(r.status) : 'unavailable' };
    // Link previews' creators within a short budget: a profile shouldn't wait on other servers.
    return { posts: await withArticleAuthors(fromStatuses(r.data as never), 800, t.access_token), accountId: id, ...(r.next ? { next: r.next } : {}) };
  });

/**
 * Someone's public posts with one of their featured hashtags, from their own server (Mastodon's `statuses?tagged=`).
 * Public data: no account needed. Fedizen's account statuses can't be filtered by hashtag (Bonfire rc.1 ignores
 * `tagged`), so the profile also keeps the posts it already has from Fedizen that use the tag.
 */
export const getFediTaggedPosts = createServerFn({ method: 'GET' })
  .inputValidator(d => z.object({ actor: actorInput, acct: acctInput, tag: z.string().regex(/^[\p{L}\p{N}_]{1,100}$/u) }).parse(d))
  .handler(async ({ data }): Promise<{ posts: FediProfilePost[]; error?: 'unavailable' }> => {
    const { taggedPostsOf } = await import('./fedi-profile.server');
    const posts = await taggedPostsOf(data.actor, data.acct, data.tag).catch(() => null);
    return posts ? { posts } : { posts: [], error: 'unavailable' };
  });
