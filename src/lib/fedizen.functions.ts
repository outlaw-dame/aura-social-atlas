import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { ForYouPost } from './feed-types';
import { allowedCallback, assertFedizenSessionIntent, creditsBesidesAuthor, fedizenReadError, fromAccounts, fromConversations, fromLists, fromNotifications, fromStatuses, hasScope, lookupAcct, type FedizenCircle, type FedizenConversation, type FedizenNotice, type FedizenPerson, type FedizenPost } from './fedizen-feed';

export const getFedizenStatus = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { tokenFor } = await import('./fedizen.server');
  const t = await tokenFor(context.userId);
  return { connected: !!t, handle: t?.account_handle ?? null, canWrite: hasScope(t?.scope, 'write') };
});

export const startFedizenConnect = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ origin: z.string().max(200), expectedAtlasUserId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // The request Origin is supplied by the browser, unlike data.origin.
    // Bind the callback to this exact serving origin (and optional deployment
    // allowlist), not merely to any tenant of the same hosting provider.
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { getRequest } = await import('@tanstack/react-start/server');
    const requestOrigin = getRequest().headers.get('origin');
    const redirect = allowedCallback(
      data.origin,
      requestOrigin,
      process.env['ATLAS_FEDIZEN_CALLBACK_ORIGINS'] ?? '',
    );
    if (!redirect) return { url: null, error: 'This address can’t connect to Fedizen.' };
    const { startConnect } = await import('./fedizen.server');
    try { return { url: await startConnect(context.userId, redirect), error: null }; }
    catch { console.error('Fedizen connection initiation unavailable'); return { url: null, error: 'Fedizen couldn’t be reached. Try again shortly.' }; }
  });

export const finishFedizenConnect = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ code: z.string().min(1).max(2000), state: z.string().min(1).max(200), expectedAtlasUserId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { finishConnect } = await import('./fedizen.server');
    return finishConnect(context.userId, data.code, data.state);
  });

export const disconnectFedizen = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
  assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
  const { disconnect } = await import('./fedizen.server');
  await disconnect(context.userId); return { ok: true };
});

/** Direct conversations (Mastodon `GET /api/v1/conversations`, which Bonfire v1.1.0-rc.1 serves) for Messages. */
export type FedizenMessages = { connected: boolean; conversations: FedizenConversation[]; error?: 'expired' | 'unavailable' };
export const getFedizenMessages = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<FedizenMessages> => {
  assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
  const { tokenFor, fedizenGet } = await import('./fedizen.server');
  const t = await tokenFor(context.userId);
  if (!t) return { connected: false, conversations: [] };
  const r = await fedizenGet(t.access_token, '/api/v1/conversations?limit=30');
  const error = r.status === 401 ? 'expired' : r.status !== 200 ? 'unavailable' : undefined;
  return { connected: true, conversations: fromConversations(r.data as never), error };
});

export type FedizenHome = {
  connected: boolean;
  /** False for connections made before Atlas asked to act for people: they reconnect once to join groups. */
  canWrite?: boolean;
  /** Verified Fedizen account identifier from the user's own delegated grant. */
  accountHandle: string | null;
  /** Server-authoritative rollout gate; prevents unnecessary native requests while disabled. */
  nativeReadEnabled?: boolean;
  posts: FedizenPost[];
  notices: FedizenNotice[];
  error?: 'expired' | 'unavailable';
};
export const getFedizenHome = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<FedizenHome> => {
  assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
  const { tokenFor, fedizenGet } = await import('./fedizen.server');
  const t = await tokenFor(context.userId);
  if (!t) return { connected: false, accountHandle: null, nativeReadEnabled: false, posts: [], notices: [] };
  const [home, notes] = await Promise.all([fedizenGet(t.access_token, '/api/v1/timelines/home?limit=20'), fedizenGet(t.access_token, '/api/v1/notifications?limit=20')]);
  const error = fedizenReadError(home.status, notes.status);
  return {
    connected: true,
    accountHandle: t.account_handle,
    canWrite: hasScope(t.scope, 'write'),
    nativeReadEnabled: process.env['ATLAS_BONFIRE_NATIVE_GRAPHQL_READS'] === 'verified',
    posts: await withArticleAuthors(fromStatuses(home.data as never)),
    notices: fromNotifications(notes.data as never),
    error,
  };
});

/**
 * "More from" for links in posts, as Mastodon shows under a link preview, but verified the Atlas way: the article's
 * own ActivityPub record (attributedTo) first, then its fediverse:creator tag; an author counts only if their
 * account is on the article's host or lists its domain (attributionDomains). Shares the Spotlight resolver's cache
 * and time budget, so a slow publisher never holds up the feed: what isn't ready shows on the next load.
 */
async function withArticleAuthors(posts: FedizenPost[], budgetMs = 2000): Promise<FedizenPost[]> {
  const urls = posts.map(p => p.article?.url).filter((u): u is string => !!u);
  if (!urls.length) return posts;
  const { resolveAuthorsFor, mediaFor } = await import('./article-author.server');
  const hints = Object.fromEntries(posts.flatMap(p => (p.article?.authorUrl ? [[p.article.url, { authorUrl: p.article.authorUrl }]] : [])));
  const found = await resolveAuthorsFor(urls, budgetMs, undefined, undefined, hints).catch(() => new Map<string, never[]>());
  return posts.map(p => {
    if (!p.article) return p;
    const a = creditsBesidesAuthor(p, found.get(p.article.url) ?? []);
    const m = mediaFor(p.article.url);
    // A post that already carries the video as an attachment needn't show it twice.
    const video = p.video ? undefined : m?.video;
    return a.length || m?.episode || video ? { ...p, article: { ...p.article, ...(a.length ? { authors: a } : {}), ...(m?.episode ? { episode: m.episode } : {}), ...(video ? { video } : {}) } } : p;
  });
}

/* ── Saved (Bonfire bookmarks) and Circles (Bonfire circles, as Mastodon Lists) ─────────────────────────── */

type Problem = 'not-connected' | 'needs-permission' | 'expired' | 'unavailable';
const me = z.object({ expectedAtlasUserId: z.string().uuid() });
const ulid = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const problem = (status: number): Problem => (status === 401 ? 'expired' : status === 403 ? 'needs-permission' : 'unavailable');

/** The connection for a personal read or write; writes need a grant that includes `write`. */
async function connection(userId: string, write = false): Promise<{ error: 'not-connected' | 'needs-permission' } | { token: string }> {
  const { tokenFor } = await import('./fedizen.server');
  const t = await tokenFor(userId);
  if (!t) return { error: 'not-connected' as const };
  if (write && !hasScope(t.scope, 'write')) return { error: 'needs-permission' as const };
  return { token: t.access_token };
}

/** Your Fedizen bookmarks, newest first. Each post keeps the audience its author gave it. */
export const getFedizenSaved = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.parse(d))
  .handler(async ({ data, context }): Promise<{ posts: FedizenPost[]; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId);
    if ('error' in c) return { posts: [], error: c.error };
    const { fedizenGet } = await import('./fedizen.server');
    const r = await fedizenGet(c.token, '/api/v1/bookmarks?limit=40');
    return r.status === 200 ? { posts: await withArticleAuthors(fromStatuses(r.data as never).map(p => ({ ...p, bookmarked: true }))) } : { posts: [], error: problem(r.status) };
  });

/** Bookmark or unbookmark a Fedizen post. */
export const setFedizenSaved = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ statusId: ulid, on: z.boolean() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; saved: boolean } | { ok: false; error: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const { fedizenSend } = await import('./fedizen.server');
    const r = await fedizenSend(c.token, 'POST', `/api/v1/statuses/${data.statusId}/${data.on ? 'bookmark' : 'unbookmark'}`);
    if (r.status < 200 || r.status >= 300) return { ok: false, error: problem(r.status) };
    return { ok: true, saved: typeof r.data?.bookmarked === 'boolean' ? r.data.bookmarked : data.on };
  });

/** Like or boost a Fedizen post, or undo it. Answers with what Fedizen now says (flag and count) when it says. */
export const setFedizenReaction = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ statusId: ulid, kind: z.enum(['like', 'boost']), on: z.boolean() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; on: boolean; count?: number } | { ok: false; error: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const { fedizenSend } = await import('./fedizen.server');
    const verb = data.kind === 'like' ? (data.on ? 'favourite' : 'unfavourite') : (data.on ? 'reblog' : 'unreblog');
    const r = await fedizenSend(c.token, 'POST', `/api/v1/statuses/${data.statusId}/${verb}`);
    if (r.status < 200 || r.status >= 300) return { ok: false, error: problem(r.status) };
    const d = (r.data ?? {}) as { favourited?: boolean | null; reblogged?: boolean | null; favourites_count?: number | null; reblogs_count?: number | null; reblog?: { reblogged?: boolean | null; reblogs_count?: number | null } | null };
    const flag = data.kind === 'like' ? d.favourited : (d.reblog?.reblogged ?? d.reblogged);
    const count = data.kind === 'like' ? d.favourites_count : (d.reblog?.reblogs_count ?? d.reblogs_count);
    return { ok: true, on: typeof flag === 'boolean' ? flag : data.on, ...(typeof count === 'number' ? { count } : {}) };
  });

/** Reply to a Fedizen post. Atlas sends the post's own audience, so a reply to a followers-only post stays followers-only. */
export const replyOnFedizen = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({
    statusId: ulid, text: z.string().trim().min(1).max(5000),
    visibility: z.enum(['public', 'unlisted', 'private', 'direct']),
  }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; url?: string } | { ok: false; error: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const { fedizenSend } = await import('./fedizen.server');
    const r = await fedizenSend(c.token, 'POST', '/api/v1/statuses', { status: data.text, in_reply_to_id: data.statusId, visibility: data.visibility });
    if (r.status < 200 || r.status >= 300) return { ok: false, error: problem(r.status) };
    const url = typeof r.data?.url === 'string' && /^https:\/\/fedizen\.net\//.test(r.data.url) ? r.data.url : undefined;
    return { ok: true, ...(url ? { url } : {}) };
  });

/** Your circles on Fedizen. */
export const getFedizenCircles = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.parse(d))
  .handler(async ({ data, context }): Promise<{ circles: FedizenCircle[]; canWrite: boolean; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { tokenFor, fedizenGet } = await import('./fedizen.server');
    const t = await tokenFor(context.userId);
    if (!t) return { circles: [], canWrite: false, error: 'not-connected' };
    const r = await fedizenGet(t.access_token, '/api/v1/lists');
    const canWrite = hasScope(t.scope, 'write');
    return r.status === 200 ? { circles: fromLists(r.data as never), canWrite } : { circles: [], canWrite, error: problem(r.status) };
  });

/** Who is in one circle. */
export const getFedizenCircleMembers = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ id: ulid }).parse(d))
  .handler(async ({ data, context }): Promise<{ people: FedizenPerson[]; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId);
    if ('error' in c) return { people: [], error: c.error };
    const { fedizenGet } = await import('./fedizen.server');
    const r = await fedizenGet(c.token, `/api/v1/lists/${data.id}/accounts?limit=80`);
    return r.status === 200 ? { people: fromAccounts(r.data as never) } : { people: [], error: problem(r.status) };
  });

/** Create, rename or delete a circle. */
export const changeFedizenCircle = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ action: z.enum(['create', 'rename', 'delete']), id: ulid.optional(), title: z.string().trim().min(1).max(100).optional() })
    .refine(v => (v.action === 'create' ? !!v.title && !v.id : v.action === 'rename' ? !!v.id && !!v.title : !!v.id && !v.title)).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; circle?: FedizenCircle } | { ok: false; error: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const { fedizenSend } = await import('./fedizen.server');
    const r = data.action === 'create' ? await fedizenSend(c.token, 'POST', '/api/v1/lists', { title: data.title })
      : data.action === 'rename' ? await fedizenSend(c.token, 'PUT', `/api/v1/lists/${data.id}`, { title: data.title })
      : await fedizenSend(c.token, 'DELETE', `/api/v1/lists/${data.id}`);
    if (r.status < 200 || r.status >= 300) return { ok: false, error: problem(r.status) };
    const id = typeof r.data?.id === 'string' ? r.data.id : data.id;
    return { ok: true, circle: id && data.action !== 'delete' ? { id, title: (typeof r.data?.title === 'string' && r.data.title) || data.title! } : undefined };
  });

/** Add someone to a circle by handle (looked up on Fedizen), or remove them by account id. */
export const changeFedizenCircleMember = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ id: ulid, add: z.string().trim().min(1).max(320).optional(), remove: ulid.optional() }).refine(v => !!v.add !== !!v.remove).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; person?: FedizenPerson } | { ok: false; error: Problem | 'not-found' }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const { fedizenGet, fedizenSend } = await import('./fedizen.server');
    let person: FedizenPerson | undefined;
    let accountId = data.remove;
    if (data.add) {
      const acct = lookupAcct(data.add);
      if (!acct) return { ok: false, error: 'not-found' };
      const found = await fedizenGet(c.token, `/api/v1/accounts/lookup?acct=${encodeURIComponent(acct)}`);
      if (found.status === 404 || (found.status === 200 && !found.data.length)) return { ok: false, error: 'not-found' };
      if (found.status !== 200) return { ok: false, error: problem(found.status) };
      person = fromAccounts(found.data as never)[0];
      if (!person) return { ok: false, error: 'not-found' };
      accountId = person.id;
    }
    const r = await fedizenSend(c.token, data.add ? 'POST' : 'DELETE', `/api/v1/lists/${data.id}/accounts`, { account_ids: [accountId!] });
    if (r.status < 200 || r.status >= 300) return { ok: false, error: problem(r.status) };
    return { ok: true, person };
  });

/* ── Moderation: people you block (Bonfire blocks, through the Mastodon API) ──────────────────────────── */

/** People you block on Fedizen. Bonfire lists blocked instances with them in its own pages; its API returns people only. */
export const getFedizenBlocks = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.parse(d))
  .handler(async ({ data, context }): Promise<{ people: FedizenPerson[]; canWrite: boolean; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { tokenFor, fedizenGet } = await import('./fedizen.server');
    const t = await tokenFor(context.userId);
    if (!t) return { people: [], canWrite: false, error: 'not-connected' };
    const r = await fedizenGet(t.access_token, '/api/v1/blocks?limit=80');
    const canWrite = hasScope(t.scope, 'write');
    return r.status === 200 ? { people: fromAccounts(r.data as never), canWrite } : { people: [], canWrite, error: problem(r.status) };
  });

/** Block someone by handle (looked up on Fedizen), or unblock them by account id. */
export const changeFedizenBlock = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ block: z.string().trim().min(1).max(320).optional(), unblock: ulid.optional() }).refine(v => !!v.block !== !!v.unblock).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; person?: FedizenPerson } | { ok: false; error: Problem | 'not-found' }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const { fedizenGet, fedizenSend } = await import('./fedizen.server');
    let person: FedizenPerson | undefined;
    let accountId = data.unblock;
    if (data.block) {
      const acct = lookupAcct(data.block);
      if (!acct) return { ok: false, error: 'not-found' };
      const found = await fedizenGet(c.token, `/api/v1/accounts/lookup?acct=${encodeURIComponent(acct)}`);
      if (found.status === 404 || (found.status === 200 && !found.data.length)) return { ok: false, error: 'not-found' };
      if (found.status !== 200) return { ok: false, error: problem(found.status) };
      person = fromAccounts(found.data as never)[0];
      if (!person) return { ok: false, error: 'not-found' };
      accountId = person.id;
    }
    const r = await fedizenSend(c.token, 'POST', `/api/v1/accounts/${accountId}/${data.block ? 'block' : 'unblock'}`);
    if (r.status < 200 || r.status >= 300) return { ok: false, error: problem(r.status) };
    return { ok: true, person };
  });

/* ── Feeds: For You and pinned circles ──────────────────────────────────────────────────────── */

/**
 * For You: your home timeline (people you follow), the timelines of up to four hashtags you follow, and the
 * most-discussed posts of the past week in the groups you're in, merged and ranked (rankForYou). A source that
 * fails is left out and named in `missing`, so the rest still shows.
 */
export const getForYou = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.parse(d))
  .handler(async ({ data, context }): Promise<{ posts: ForYouPost[]; tags: string[]; groups: string[]; missing: ('following' | 'tags' | 'groups')[]; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId);
    if ('error' in c) return { posts: [], tags: [], groups: [], missing: [], error: c.error };
    const [{ fedizenGet }, { joinedGroups, popularInGroups }, { rankForYou, fromGroupPost }] = await Promise.all([import('./fedizen.server'), import('./groups.server'), import('./feed-types')]);
    const missing: ('following' | 'tags' | 'groups')[] = [];
    const [home, followed, joined] = await Promise.all([
      fedizenGet(c.token, '/api/v1/timelines/home?limit=20'),
      fedizenGet(c.token, '/api/v1/followed_tags?limit=20'),
      joinedGroups(context.userId).catch(() => null),
    ]);
    if (home.status === 401) return { posts: [], tags: [], groups: [], missing: [], error: 'expired' };
    if (home.status !== 200) missing.push('following');
    const tags = followed.status === 200 ? (followed.data as { name: string }[]).map(t => t.name.replace(/^#/, '')).slice(0, 4) : [];
    if (followed.status !== 200) missing.push('tags');
    const [tagFeeds, popular] = await Promise.all([
      Promise.all(tags.map(async tag => {
        // One tag that can't be read leaves the others, and the rest of For You, untouched.
        const r = await fedizenGet(c.token, `/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=10`).catch(() => null);
        return { tag, ok: r?.status === 200, posts: r?.status === 200 ? fromStatuses(r.data as never) : [] };
      })),
      joined ? popularInGroups(joined.groups.map(g => g.id)).catch(() => null) : Promise.resolve(null),
    ]);
    if (tagFeeds.some(t => !t.ok) && !missing.includes('tags')) missing.push('tags');
    if (!joined || !joined.complete || !popular || !popular.complete) missing.push('groups');
    const posts = rankForYou({
      following: home.status === 200 ? fromStatuses(home.data as never) : [],
      tags: tagFeeds.map(({ tag, posts }) => ({ tag, posts })),
      // A post shared into several of your groups counts once for each of them.
      groups: (popular?.posts ?? []).flatMap(p => (p.groups?.length ? p.groups : [p.group]).map(group => ({ ...fromGroupPost(p), group }))),
    });
    // Credits and players for the links in them, as on Following.
    const withAuthors = await withArticleAuthors(posts);
    return { posts: withAuthors as ForYouPost[], tags, groups: (joined?.groups ?? []).map(g => g.name), missing };
  });

/** A circle's feed: posts from the people in it (Bonfire serves circles as Mastodon lists). */
export const getCircleFeed = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ id: ulid }).parse(d))
  .handler(async ({ data, context }): Promise<{ posts: FedizenPost[]; error?: Problem | 'not-found' }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId);
    if ('error' in c) return { posts: [], error: c.error };
    const { fedizenGet } = await import('./fedizen.server');
    const r = await fedizenGet(c.token, `/api/v1/timelines/list/${data.id}?limit=20`);
    if (r.status === 404) return { posts: [], error: 'not-found' };
    if (r.status !== 200) return { posts: [], error: problem(r.status) };
    return { posts: await withArticleAuthors(fromStatuses(r.data as never)) };
  });
