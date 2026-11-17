import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { ForYouPost } from './feed-types';
import { DEFAULT_LIMITS, MAX_ALT, MAX_CW, MAX_TEXT, UPLOAD_CEILING, type ComposeLimits } from './compose-media';
import { allowedCallback, assertFedizenSessionIntent, creditsBesidesAuthor, pollOf, type FediPoll, fedizenReadError, fromAccounts, fromConversations, fromLists, fromNotifications, fromStatuses, hasScope, lookupAcct, type FedizenCircle, type FedizenConversation, type FedizenNotice, type FedizenPerson, type FedizenPost } from './fedizen-feed';

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
    const { startConnect, FedizenConnectError } = await import('./fedizen.server');
    try { return { url: await startConnect(context.userId, redirect), error: null }; }
    catch (e) {
      const known = e instanceof FedizenConnectError;
      // No raw Error.message, URL, client secret, grant or remote response.
      console.error('Fedizen connection initiation unavailable', {
        stage: known ? e.stage : 'unexpected',
        ...(known && e.httpStatus ? { httpStatus: e.httpStatus } : {}),
        ...(known && e.transport ? { transport: e.transport } : {}),
      });
      return {
        url: null,
        error: known && e.stage === 'storage'
          ? 'Atlas couldn’t save the Fedizen connection. Please retry shortly.'
          : known && e.stage === 'registration-http'
            ? 'Fedizen refused Atlas’s app registration. Please retry shortly.'
            : known && e.stage === 'registration-response'
              ? 'Fedizen returned an invalid registration response. Please retry shortly.'
              : 'Atlas couldn’t contact Fedizen to register the connection. Please retry shortly.',
      };
    }
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
  const { revoked } = await disconnect(context.userId); return { ok: true, revoked };
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
  /** The cursor for the next (older) page of Home, from Fedizen's Link header. */
  next?: string;
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
    posts: await withArticleAuthors(fromStatuses(home.data as never), 2000, t.access_token),
    notices: await withActorAvatars(fromNotifications(notes.data as never)),
    ...(home.next ? { next: home.next } : {}),
    error,
  };
});

/** An older page of Home (max_id cursor from the previous page's Link header), loaded before the reader reaches it. */
export const getFedizenHomePage = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: z.string().uuid(), max: z.string().min(1).max(512) }).parse(d))
  .handler(async ({ data, context }): Promise<{ posts: FedizenPost[]; next?: string; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { tokenFor, fedizenGet, PAGE_CURSOR } = await import('./fedizen.server');
    const cursor = encodeURIComponent(data.max);
    if (!PAGE_CURSOR.test(cursor)) return { posts: [], error: 'unavailable' };
    const t = await tokenFor(context.userId);
    if (!t) return { posts: [], error: 'not-connected' };
    const r = await fedizenGet(t.access_token, `/api/v1/timelines/home?limit=20&max_id=${cursor}`).catch(() => null);
    if (!r || r.status !== 200) return { posts: [], error: r ? problem(r.status) : 'unavailable' };
    return { posts: await withArticleAuthors(fromStatuses(r.data as never), 2000, t.access_token), ...(r.next ? { next: r.next } : {}) };
  });

/**
 * The newest page of Home only (no notifications), for the background check for new posts. The browser works out
 * which are new against what it shows, so this needs no cursor and can't miss posts if Fedizen's cursors change.
 */
export const getFedizenHomeLatest = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ posts: FedizenPost[]; notices?: FedizenNotice[]; next?: string; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { tokenFor, fedizenGet } = await import('./fedizen.server');
    const t = await tokenFor(context.userId);
    if (!t) return { posts: [], error: 'not-connected' };
    const [r, n] = await Promise.all([
      fedizenGet(t.access_token, '/api/v1/timelines/home?limit=20').catch(() => null),
      fedizenGet(t.access_token, '/api/v1/notifications?limit=20').catch(() => null),
    ]);
    if (!r || r.status !== 200) return { posts: [], error: r ? problem(r.status) : 'unavailable' };
    return {
      posts: await withArticleAuthors(fromStatuses(r.data as never), 1200, t.access_token), ...(r.next ? { next: r.next } : {}),
      ...(n?.status === 200 ? { notices: await withActorAvatars(fromNotifications(n.data as never), 800) } : {}),
    };
  });

/**
 * "More from" for links in posts, as Mastodon shows under a link preview, but verified the Atlas way: the article's
 * own ActivityPub record (attributedTo) first, then its fediverse:creator tag; an author counts only if their
 * account is on the article's host or lists its domain (attributionDomains). Shares the Spotlight resolver's cache
 * and time budget, so a slow publisher never holds up the feed: what isn't ready shows on the next load.
 */
async function withArticleAuthors(posts: FedizenPost[], budgetMs = 2000, token?: string): Promise<FedizenPost[]> {
  const enriched = await withArticleAuthorsAndFaces(posts, budgetMs);
  return token ? withReplyParents(enriched, token, Math.min(budgetMs, 1500)) : enriched;
}

/**
 * The post each reply answers, shown above it in feeds as Ivory and Phanpy do (Bonfire's own feed shows only "reply
 * in thread"). Read from Fedizen with the reader's own connection, so Fedizen's boundaries and blocks decide: a parent
 * it won't show (a blocked author or instance, a post the reader may not see) is simply left out. A parent already on
 * the page is reused. At most 12 per page, in parallel, within a time budget.
 */
async function withReplyParents(posts: FedizenPost[], token: string, budgetMs: number): Promise<FedizenPost[]> {
  const onPage = new Map(posts.map(p => [p.statusId ?? p.id, p]));
  const wanted = [...new Set(posts.flatMap(p => (p.replyTo && !onPage.has(p.replyTo.statusId) ? [p.replyTo.statusId] : [])))].slice(0, 12);
  const found = new Map<string, FedizenPost>();
  if (wanted.length) {
    const { fedizenGet } = await import('./fedizen.server');
    const work = Promise.all(wanted.map(async id => {
      const r = await fedizenGet(token, `/api/v1/statuses/${id}`).catch(() => null);
      const parent = r?.status === 200 ? fromStatuses(r.data as never)[0] : undefined;
      if (parent) found.set(id, parent);
    }));
    await Promise.race([work, new Promise(res => setTimeout(res, budgetMs))]);
  }
  return posts.map(p => {
    if (!p.replyTo) return p;
    const parent = found.get(p.replyTo.statusId) ?? onPage.get(p.replyTo.statusId);
    // One level: the parent's own parent isn't carried.
    return parent ? { ...p, replyTo: { statusId: p.replyTo.statusId, post: { ...parent, replyTo: undefined } } } : p;
  });
}

async function withArticleAuthorsAndFaces(posts: FedizenPost[], budgetMs = 2000): Promise<FedizenPost[]> {
  // Authors' and boosters' real avatars where Fedizen gave its placeholder, alongside the article work.
  const [withAuthors, faces] = await Promise.all([withArticleAuthorsOnly(posts, budgetMs), actorAvatars(posts.flatMap(p => [
    ...(!p.avatar && p.actor ? [p.actor] : []), ...(p.booster && !p.booster.avatar && p.booster.actor ? [p.booster.actor] : []),
  ]), Math.min(budgetMs, 1500))]);
  if (!faces.size) return withAuthors;
  return withAuthors.map(p => {
    const a = !p.avatar && p.actor ? faces.get(p.actor) : undefined;
    const b = p.booster && !p.booster.avatar && p.booster.actor ? faces.get(p.booster.actor) : undefined;
    return a || b ? { ...p, ...(a ? { avatar: a } : {}), ...(b && p.booster ? { booster: { ...p.booster, avatar: b } } : {}) } : p;
  });
}

/** Notices' real avatars where Fedizen gave its placeholder. */
async function withActorAvatars(notices: FedizenNotice[], budgetMs = 1200): Promise<FedizenNotice[]> {
  const faces = await actorAvatars(notices.flatMap(n => (!n.avatar && n.actor ? [n.actor] : [])), budgetMs);
  return faces.size ? notices.map(n => (!n.avatar && n.actor && faces.get(n.actor) ? { ...n, avatar: faces.get(n.actor) } : n)) : notices;
}

/**
 * The avatar an actor itself publishes (its `icon`), for accounts Fedizen shows with its placeholder picture. Read
 * through the guarded fetch (public hosts only, size and time limits, no cookies), cached per isolate, and bounded by
 * a time budget: one that isn't back in time shows its initial now and its picture on the next load.
 */
const avatarCache = new Map<string, { at: number; url: string | null }>();
async function actorAvatars(actors: string[], budgetMs: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const todo: string[] = [];
  for (const a of [...new Set(actors)].slice(0, 24)) {
    const hit = avatarCache.get(a);
    if (hit && Date.now() - hit.at < (hit.url ? 6 * 3600_000 : 3600_000)) { if (hit.url) out.set(a, hit.url); } else todo.push(a);
  }
  if (!todo.length) return out;
  const { fetchActor } = await import('./article-author.server');
  const { isPublicHttpsUrl } = await import('./article-author');
  const work = Promise.all(todo.map(async a => {
    const actor = await fetchActor(a).catch(() => null);
    const icon = actor ? [actor.icon].flat()[0] : undefined;
    const raw = typeof icon === 'string' ? icon : icon && typeof icon === 'object' ? (icon as { url?: unknown }).url : undefined;
    const url = typeof raw === 'string' && isPublicHttpsUrl(raw) && raw.length <= 2048 ? raw : null;
    if (avatarCache.size >= 1000) avatarCache.delete(avatarCache.keys().next().value as string);
    avatarCache.set(a, { at: Date.now(), url });
    if (url) out.set(a, url);
  }));
  await Promise.race([work, new Promise(r => setTimeout(r, budgetMs))]);
  return new Map(out);
}

async function withArticleAuthorsOnly(posts: FedizenPost[], budgetMs = 2000): Promise<FedizenPost[]> {
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
    // Fedizen made no card for this link: the page's own preview (read while resolving its authors) stands in.
    const preview: { title?: string; description?: string; image?: string; provider?: string } = !p.article.title && m?.preview ? {
      title: m.preview.title, ...(m.preview.description ? { description: m.preview.description } : {}),
      ...(m.preview.image ? { image: m.preview.image } : {}), ...(m.preview.provider ? { provider: m.preview.provider } : {}),
    } : {};
    return a.length || m?.episode || video || preview.title ? { ...p, article: { ...p.article, ...preview, ...(a.length ? { authors: a } : {}), ...(m?.episode ? { episode: m.episode } : {}), ...(video ? { video } : {}) } } : p;
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
    return r.status === 200 ? { posts: await withArticleAuthors(fromStatuses(r.data as never).map(p => ({ ...p, bookmarked: true })), 2000, c.token) } : { posts: [], error: problem(r.status) };
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

/** People to mention: Fedizen's account search for what follows "@" (name or handle), at most six. */
export const searchFedizenPeople = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ q: z.string().trim().regex(/^@?[A-Za-z0-9_.-]{1,64}(@[A-Za-z0-9.-]{0,253})?$/) }).parse(d))
  .handler(async ({ data, context }): Promise<{ people: FedizenPerson[]; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId);
    if ('error' in c) return { people: [], error: c.error };
    const { fedizenGet } = await import('./fedizen.server');
    const q = data.q.replace(/^@/, '').replace(/@$/, '');
    const r = await fedizenGet(c.token, `/api/v1/accounts/search?q=${encodeURIComponent(q)}&limit=6`).catch(() => null);
    if (!r || r.status !== 200) return { people: [], error: r ? problem(r.status) : 'unavailable' };
    return { people: fromAccounts(r.data as never).slice(0, 6) };
  });

/** Reply to a Fedizen post. Atlas sends the post's own audience, so a reply to a followers-only post stays followers-only. */
export const replyOnFedizen = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({
    statusId: ulid, text: z.string().trim().min(1).max(5000),
    /** The reply's content warning: the post's own by default (Mastodon carries it over too). */
    cw: z.string().trim().max(500).optional(),
    visibility: z.enum(['public', 'unlisted', 'private', 'direct']),
  }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; url?: string } | { ok: false; error: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const { fedizenSend } = await import('./fedizen.server');
    const r = await fedizenSend(c.token, 'POST', '/api/v1/statuses', { status: data.text, in_reply_to_id: data.statusId, visibility: data.visibility, ...(data.cw ? { spoiler_text: data.cw } : {}) });
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
    const joinedByName = new Map((joined?.groups ?? []).map(g => [g.name.toLowerCase(), g] as const));
    const posts = rankForYou({
      following: home.status === 200 ? fromStatuses(home.data as never) : [],
      tags: tagFeeds.map(({ tag, posts }) => ({ tag, posts })),
      // A post shared into several of your groups counts once for each of them. Each is matched to your joined group
      // of that name for its id and avatar (the chip shows the avatar and opens the group).
      groups: (popular?.posts ?? []).flatMap(p => (p.groups?.length ? p.groups : [p.group]).map(group => {
        const g = group ? joinedByName.get(group.toLowerCase()) : undefined;
        return { ...fromGroupPost(p), group, ...(g ? { groupId: g.id, ...(g.avatar ? { groupAvatar: g.avatar } : {}) } : {}) };
      })),
    });
    // Group posts come from Fedizen's public feed, which doesn't know what you've liked, boosted or saved: read each
    // as you see it. One that can't be read keeps Share only, so no button claims a state it doesn't know.
    const hydrate = async (p: ForYouPost): Promise<ForYouPost> => {
      if (!p.id.startsWith('g-') || !p.statusId) return p;
      const r = await fedizenGet(c.token, `/api/v1/statuses/${p.statusId}`).catch(() => null);
      const s = r?.status === 200 ? fromStatuses(r.data as never)[0] : undefined;
      if (!s) { const { statusId: _drop, ...rest } = p; return rest as ForYouPost; }
      return { ...p, statusId: s.statusId, bookmarked: s.bookmarked, counts: s.counts, liked: s.liked, boosted: s.boosted, visibility: s.visibility, article: p.article ?? s.article,
        // The REST read also carries what the public feed leaves out: an attached video and the full preview image.
        ...(s.video && !p.video ? { video: s.video } : {}), ...(!p.image && s.image ? { image: s.image } : {}), ...(s.collections && !p.collections ? { collections: s.collections } : {}) } as ForYouPost;
    };
    const hydrated: ForYouPost[] = [];
    for (let i = 0; i < posts.length; i += 8) hydrated.push(...await Promise.all(posts.slice(i, i + 8).map(hydrate)));
    // Credits and players for the links in them, as on Following.
    const withAuthors = await withArticleAuthors(hydrated);
    return { posts: withAuthors as ForYouPost[], tags, groups: (joined?.groups ?? []).map(g => g.name), missing };
  });

/** The hashtags the person follows on Fedizen (lowercase, no "#"), for marking posts that use them. */
export const getFollowedTags = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.parse(d))
  .handler(async ({ data, context }): Promise<{ tags: string[]; names?: string[]; full?: boolean; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId);
    if ('error' in c) return { tags: [], error: c.error };
    const { fedizenGet } = await import('./fedizen.server');
    const r = await fedizenGet(c.token, '/api/v1/followed_tags?limit=200').catch(() => null);
    if (!r || r.status !== 200) return { tags: [], error: r ? problem(r.status) : 'unavailable' };
    const names = (r.data as { name: string }[]).map(t => t.name.replace(/^#/, ''));
    return { tags: [...new Set(names.map(n => n.toLowerCase()))], names, full: names.length >= 200 };
  });

/** Follow or unfollow a hashtag from the person's Fedizen account, as Mastodon does: one tap on the tag's page. */
export const setTagFollow = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ tag: z.string().regex(/^[\p{L}\p{N}_]{1,100}$/u), on: z.boolean() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; following: boolean } | { ok: false; error: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const { fedizenSend } = await import('./fedizen.server');
    const r = await fedizenSend(c.token, 'POST', `/api/v1/tags/${encodeURIComponent(data.tag)}/${data.on ? 'follow' : 'unfollow'}`);
    // Unfollowing a tag Fedizen has never seen answers 404: either way, it isn't followed.
    if (!data.on && r.status === 404) return { ok: true, following: false };
    if (r.status < 200 || r.status >= 300) return { ok: false, error: problem(r.status) };
    return { ok: true, following: typeof r.data?.following === 'boolean' ? r.data.following : data.on };
  });

/** A hashtag's feed as the person sees it on Fedizen: the posts using it that they may see and act on (Bonfire applies
 *  each post's audience to their account). */
export const getFedizenTagFeed = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ tag: z.string().regex(/^[\p{L}\p{N}_]{1,100}$/u) }).parse(d))
  .handler(async ({ data, context }): Promise<{ posts: FedizenPost[]; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId);
    if ('error' in c) return { posts: [], error: c.error };
    const { fedizenGet } = await import('./fedizen.server');
    const r = await fedizenGet(c.token, `/api/v1/timelines/tag/${encodeURIComponent(data.tag)}?limit=20`).catch(() => null);
    if (!r || r.status !== 200) return { posts: [], error: r ? problem(r.status) : 'unavailable' };
    return { posts: await withArticleAuthors(fromStatuses(r.data as never), 2000, c.token) };
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
    return { posts: await withArticleAuthors(fromStatuses(r.data as never), 2000, c.token) };
  });


/** What Fedizen takes in a post: its upload size limits (capped by what Atlas relays) and length. */
export const getFedizenComposeLimits = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.parse(d))
  .handler(async ({ data, context }): Promise<ComposeLimits> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId);
    if ('error' in c) return DEFAULT_LIMITS;
    const { fedizenGet } = await import('./fedizen.server');
    const r = await fedizenGet(c.token, '/api/v2/instance').catch(() => null);
    const conf = (r?.status === 200 ? (r.data[0] as { configuration?: { statuses?: { max_characters?: number | null } | null; media_attachments?: { image_size_limit?: number | null; video_size_limit?: number | null } | null } | null }) : null)?.configuration;
    const cap = (n: number | null | undefined, fallback: number) => Math.min(UPLOAD_CEILING, n && n > 0 ? n : fallback);
    return {
      imageBytes: cap(conf?.media_attachments?.image_size_limit, DEFAULT_LIMITS.imageBytes),
      videoBytes: cap(conf?.media_attachments?.video_size_limit, DEFAULT_LIMITS.videoBytes),
      maxChars: Math.min(MAX_TEXT, conf?.statuses?.max_characters ?? MAX_TEXT),
    };
  });

/**
 * Uploads one image or video for a post, with its alt text (multipart, relayed to Fedizen's /api/v2/media). The
 * size limit is Fedizen's own, read again here rather than trusted from the browser.
 */
export const uploadFedizenMedia = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error('Expected a form.');
    const file = d.get('file');
    if (!(file instanceof Blob)) throw new Error('Expected a file.');
    const parsed = me.extend({ description: z.string().max(MAX_ALT) }).parse({ expectedAtlasUserId: d.get('expectedAtlasUserId'), description: d.get('description') ?? '' });
    return { ...parsed, file, name: typeof (file as File).name === 'string' ? (file as File).name : 'upload' };
  })
  .handler(async ({ data, context }): Promise<{ ok: true; id: string; preview?: string } | { ok: false; error: Problem | 'too-large' | 'unsupported' }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const { fedizenGet, fedizenUpload, MEDIA_UPLOAD_TYPES } = await import('./fedizen.server');
    if (!MEDIA_UPLOAD_TYPES.includes(data.file.type)) return { ok: false, error: 'unsupported' };
    const r0 = await fedizenGet(c.token, '/api/v2/instance').catch(() => null);
    const ma = (r0?.status === 200 ? (r0.data[0] as { configuration?: { media_attachments?: { image_size_limit?: number | null; video_size_limit?: number | null } | null } | null }) : null)?.configuration?.media_attachments;
    const video = data.file.type.startsWith('video/');
    const limit = Math.min(UPLOAD_CEILING, (video ? ma?.video_size_limit : ma?.image_size_limit) || (video ? DEFAULT_LIMITS.videoBytes : DEFAULT_LIMITS.imageBytes));
    if (data.file.size > limit) return { ok: false, error: 'too-large' };
    const r = await fedizenUpload(c.token, data.file, data.name, data.description, limit);
    if (!r.id) return { ok: false, error: r.status === 413 ? 'too-large' : r.status === 422 ? 'unsupported' : problem(r.status) };
    return { ok: true, id: r.id, ...(r.preview ? { preview: r.preview } : {}) };
  });

/**
 * Publishes a new post on Fedizen: text, an optional content warning, an audience, and up to 4 uploaded media.
 * As on Mastodon, a content warning marks the media sensitive.
 */
export const postOnFedizen = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({
    text: z.string().trim().max(MAX_TEXT),
    cw: z.string().trim().max(MAX_CW).optional(),
    visibility: z.enum(['public', 'unlisted', 'private', 'direct']),
    mediaIds: z.array(ulid).max(4).default([]),
    sensitive: z.boolean().default(false),
    poll: z.object({ options: z.array(z.string().trim().min(1).max(200)).min(2).max(4), expiresIn: z.number().int().min(300).max(2_629_746), multiple: z.boolean() }).optional(),
  }).refine(p => p.text.length > 0 || p.mediaIds.length > 0 || !!p.poll, 'empty post').refine(p => !(p.poll && p.mediaIds.length), 'a poll has no media').parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; url?: string; id?: string } | { ok: false; error: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const { fedizenSend } = await import('./fedizen.server');
    const media = data.mediaIds.length > 0;
    const r = await fedizenSend(c.token, 'POST', '/api/v1/statuses', {
      status: data.text, visibility: data.visibility,
      ...(data.cw ? { spoiler_text: data.cw } : {}),
      ...(media ? { media_ids: data.mediaIds, sensitive: data.sensitive || !!data.cw } : {}),
      ...(data.poll ? { poll: { options: data.poll.options, expires_in: data.poll.expiresIn, multiple: data.poll.multiple } } : {}),
    });
    if (r.status < 200 || r.status >= 300) return { ok: false, error: problem(r.status) };
    const url = typeof r.data?.url === 'string' && /^https:\/\/fedizen\.net\//.test(r.data.url) ? r.data.url : undefined;
    const id = typeof r.data?.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(r.data.id) ? r.data.id : undefined;
    return { ok: true, ...(url ? { url } : {}), ...(id ? { id } : {}) };
  });


/**
 * A new Public or Quiet public post through Bonfire GraphQL `createPost` (CREATE_POST_DOCUMENT says why not REST):
 * the person's text, content warning and up to 4 uploaded media, who may quote it (lib/quote-policy), and, when
 * quoting, the quoted post (FEP-044f; if its author must approve quotes, Bonfire sends them a request).
 */
export const createPostOnFedizen = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({
    quoteId: ulid.optional(),
    text: z.string().trim().max(MAX_TEXT),
    cw: z.string().trim().max(MAX_CW).optional(),
    visibility: z.enum(['public', 'unlisted']),
    mediaIds: z.array(ulid).max(4).default([]),
    quotes: z.enum(['anyone', 'ask', 'nobody']),
  }).refine(p => p.text.length > 0 || p.mediaIds.length > 0, 'empty post').parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; url?: string; id?: string } | { ok: false; error: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const { requestBonfireGraphQL, BonfireGraphQLError } = await import('./bonfire-graphql.server');
    const { CREATE_POST_DOCUMENT } = await import('./bonfire/graphql/operations');
    const { quotePermissions } = await import('./quote-policy');
    try {
      const r = await requestBonfireGraphQL({
        operation: 'mutation', document: CREATE_POST_DOCUMENT, accessToken: c.token,
        variables: {
          postContent: { htmlBody: data.text, ...(data.cw ? { summary: data.cw } : {}) },
          boundary: data.visibility, permissions: quotePermissions(data.quotes),
          ...(data.quoteId ? { quoteId: data.quoteId } : {}),
          ...(data.mediaIds.length ? { uploadedMedia: data.mediaIds } : {}),
        },
        validate: v => z.object({ createPost: z.object({ id: z.string().max(64), activity: z.object({ canonicalUri: z.string().max(2048).nullish() }).nullish() }) }).parse(v).createPost,
      });
      const url = r.activity?.canonicalUri && /^https:\/\/fedizen\.net\//.test(r.activity.canonicalUri) ? r.activity.canonicalUri : undefined;
      const id = /^[A-Za-z0-9_-]{1,64}$/.test(r.id) ? r.id : undefined;
      return { ok: true, ...(url ? { url } : {}), ...(id ? { id } : {}) };
    } catch (e) {
      const status = e instanceof BonfireGraphQLError ? e.status : undefined;
      return { ok: false, error: status ? problem(status) : 'unavailable' };
    }
  });

type GifProblem = 'not-configured' | 'busy' | 'unavailable';

/**
 * GIFs for the composer's picker from KLIPY (lib/klipy.server): trending with no `q`, else a search. Signed-in only,
 * so Atlas's KLIPY key is spent on its own people; KLIPY sees Atlas's server, not the person.
 */
export const getGifs = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({
    q: z.string().trim().max(100).default(''),
    page: z.number().int().min(1).max(40).default(1),
    locale: z.string().regex(/^[a-z]{2}_[A-Z]{2}$/).optional(),
  }).parse(d))
  .handler(async ({ data }): Promise<{ ok: true; gifs: import('./klipy.server').Gif[]; hasNext: boolean } | { ok: false; error: GifProblem }> => {
    const { listGifs, KlipyError } = await import('./klipy.server');
    try { return { ok: true, ...(await listGifs(data.q, data.page, data.locale)) }; }
    catch (e) { return { ok: false, error: e instanceof KlipyError ? e.reason : 'unavailable' }; }
  });

/** Whether this Atlas has a KLIPY key, so the composer offers GIFs at all. */
export const getGifsEnabled = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth]).handler(async () => {
  const { klipyKey } = await import('./klipy.server');
  return { enabled: !!klipyKey() };
});

/**
 * Puts a KLIPY GIF on Fedizen as an image of the person's, with its alt text, when the post is sent: the server looks
 * the GIF up by slug (never a URL from the browser), takes the largest size within Fedizen's image limit, checks
 * it really is a GIF, and uploads it as any other image. Answers the media id to attach.
 */
export const attachGifOnFedizen = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ slug: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), description: z.string().max(MAX_ALT) }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; id: string } | { ok: false; error: Problem | GifProblem | 'too-large' }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const { fedizenGet, fedizenUpload } = await import('./fedizen.server');
    const k = await import('./klipy.server');
    const r0 = await fedizenGet(c.token, '/api/v2/instance').catch(() => null);
    const limit = Math.min(UPLOAD_CEILING, (r0?.status === 200 ? (r0.data[0] as { configuration?: { media_attachments?: { image_size_limit?: number | null } | null } | null }) : null)?.configuration?.media_attachments?.image_size_limit || DEFAULT_LIMITS.imageBytes);
    try {
      const file = k.pickFile(await k.gifItem(data.slug), limit);
      if (!file) return { ok: false, error: 'too-large' };
      const gif = await k.downloadGif(file.url, limit);
      const r = await fedizenUpload(c.token, gif, `${data.slug}.gif`, data.description, limit);
      if (!r.id) return { ok: false, error: r.status === 413 ? 'too-large' : problem(r.status) };
      await k.countShare(data.slug);
      return { ok: true, id: r.id };
    } catch (e) {
      return { ok: false, error: k.isTooLarge(e) ? 'too-large' : e instanceof k.KlipyError ? e.reason : 'unavailable' };
    }
  });


/* ── Your own posts, polls, follow requests and post search ───────────────────────────────────────────── */

const statusId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Deletes one of your own posts (Fedizen checks it's yours: Bonfire's delete_status answers 403 otherwise). */
export const deleteFedizenPost = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ statusId }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: Problem | 'not-found' }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const { fedizenSend } = await import('./fedizen.server');
    const r = await fedizenSend(c.token, 'DELETE', `/api/v1/statuses/${data.statusId}`);
    return r.status >= 200 && r.status < 300 ? { ok: true } : { ok: false, error: r.status === 404 ? 'not-found' : problem(r.status) };
  });

/**
 * A post's text and content warning, to edit it, as Mastodon's edit starts from the status source. Bonfire answers
 * the stored HTML; Atlas edits plain text, one paragraph per blank line.
 */
export const getFedizenPostSource = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ statusId }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; text: string; cw: string } | { ok: false; error: Problem | 'not-found' }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const { fedizenGet } = await import('./fedizen.server');
    const { htmlToParagraphs } = await import('./spotlight');
    const r = await fedizenGet(c.token, `/api/v1/statuses/${data.statusId}/source`).catch(() => null);
    const src = r?.status === 200 ? r.data[0] as { text?: string; spoiler_text?: string | null } | undefined : undefined;
    if (!src) return { ok: false, error: r?.status === 404 ? 'not-found' : problem(r?.status ?? 503) };
    const raw = src.text ?? '';
    const text = /<[a-z][^>]*>/i.test(raw) ? htmlToParagraphs(raw).join('\n\n') : raw;
    return { ok: true, text, cw: (src.spoiler_text ?? '').trim() };
  });

/** Edits the text and content warning of one of your own posts (Mastodon PUT /statuses/:id; Bonfire update_status). */
export const editFedizenPost = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ statusId, text: z.string().trim().max(MAX_TEXT), cw: z.string().trim().max(MAX_CW).default('') })
    .refine(p => p.text.length > 0 || p.cw.length > 0, 'empty post').parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: Problem | 'not-found' }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const { fedizenSend } = await import('./fedizen.server');
    const r = await fedizenSend(c.token, 'PUT', `/api/v1/statuses/${data.statusId}`, { status: data.text, spoiler_text: data.cw });
    return r.status >= 200 && r.status < 300 ? { ok: true } : { ok: false, error: r.status === 404 ? 'not-found' : problem(r.status) };
  });

/** Votes in a poll by option index, and answers the poll's counts after the vote. */
export const voteOnFedizenPoll = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ pollId: statusId, choices: z.array(z.number().int().min(0).max(99)).min(1).max(100) }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; poll?: FediPoll } | { ok: false; error: Problem | 'closed' }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const { fedizenSend } = await import('./fedizen.server');
    const r = await fedizenSend(c.token, 'POST', `/api/v1/polls/${data.pollId}/votes`, { choices: [...new Set(data.choices)] });
    if (r.status < 200 || r.status >= 300) return { ok: false, error: r.status === 422 ? 'closed' : problem(r.status) };
    const poll = r.data ? pollOf({ ...(r.data as object), id: data.pollId } as never) : null;
    return { ok: true, ...(poll ? { poll } : {}) };
  });

/** A poll's latest counts (to refresh results). */
export const getFedizenPoll = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ pollId: statusId }).parse(d))
  .handler(async ({ data, context }): Promise<{ poll: FediPoll | null }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId);
    if ('error' in c) return { poll: null };
    const { fedizenGet } = await import('./fedizen.server');
    const r = await fedizenGet(c.token, `/api/v1/polls/${data.pollId}`).catch(() => null);
    return { poll: r?.status === 200 ? pollOf(r.data[0] as never) : null };
  });

/** People asking to follow you: a locked account approves each one (Mastodon /follow_requests). */
export const getFollowRequests = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.parse(d))
  .handler(async ({ data, context }): Promise<{ people: (FedizenPerson & { acct?: string; actor?: string })[]; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId);
    if ('error' in c) return { people: [], error: c.error };
    const { fedizenGet } = await import('./fedizen.server');
    const { fullAcct } = await import('./fedizen-feed');
    const { isPublicHttpsUrl } = await import('./article-author');
    const r = await fedizenGet(c.token, '/api/v1/follow_requests?limit=40').catch(() => null);
    if (!r || r.status !== 200) return { people: [], error: r ? problem(r.status) : 'unavailable' };
    const raw = r.data as { acct?: string; url?: string | null; uri?: string | null }[];
    return { people: fromAccounts(r.data as never).map((p, i) => {
      const acct = fullAcct(raw[i]?.acct), actor = [raw[i]?.uri, raw[i]?.url].find(u => isPublicHttpsUrl(u ?? undefined)) ?? undefined;
      return { ...p, ...(acct ? { acct } : {}), ...(actor ? { actor } : {}) };
    }) };
  });

/** Accepts or declines someone's request to follow you. */
export const answerFollowRequest = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ accountId: statusId, accept: z.boolean() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const { fedizenSend } = await import('./fedizen.server');
    const r = await fedizenSend(c.token, 'POST', `/api/v1/follow_requests/${data.accountId}/${data.accept ? 'authorize' : 'reject'}`);
    return r.status >= 200 && r.status < 300 ? { ok: true } : { ok: false, error: problem(r.status) };
  });

/**
 * Posts Fedizen knows about that match a search (Mastodon v2 search, statuses), as the reader may see them. With
 * Intelligence on, the search is semantic: `related` carries up to four other searches from the person's own AI model
 * (useSearchPosts asks it, on their device or Atlas's server, wherever their key is), and every search runs at once. Posts that match the search itself come first, then those matching more of the other searches, newest first.
 */
export const searchFedizenPosts = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ q: z.string().trim().min(2).max(200), related: z.array(z.string().trim().min(2).max(40)).max(4).default([]) }).parse(d))
  .handler(async ({ data, context }): Promise<{ posts: FedizenPost[]; error?: Problem; related?: string[] }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId);
    if ('error' in c) return { posts: [], error: c.error };
    const { fedizenGet } = await import('./fedizen.server');
    const seen = new Set([data.q.toLowerCase()]);
    const related = data.related.filter(t => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    const runs = await Promise.all([data.q, ...related].map(q => fedizenGet(c.token, `/api/v2/search?q=${encodeURIComponent(q)}&type=statuses&limit=20`).catch(() => null)));
    const first = runs[0];
    if (!first || first.status !== 200) {
      if (!runs.some(r => r?.status === 200)) return { posts: [], error: first ? problem(first.status) : 'unavailable' };
    }
    const score = new Map<string, { status: unknown; exact: boolean; hits: number; at: number }>();
    runs.forEach((r, i) => {
      if (r?.status !== 200) return;
      for (const st of ((r.data[0] as { statuses?: { id: string; created_at?: string }[] } | undefined)?.statuses ?? [])) {
        const cur = score.get(st.id) ?? { status: st, exact: false, hits: 0, at: Date.parse(st.created_at ?? '') || 0 };
        cur.hits += 1; if (i === 0) cur.exact = true;
        score.set(st.id, cur);
      }
    });
    const ranked = [...score.values()].sort((a, b) => Number(b.exact) - Number(a.exact) || b.hits - a.hits || b.at - a.at).slice(0, 30).map(x => x.status);
    return { posts: await withArticleAuthors(fromStatuses(ranked as never), 1500, c.token), ...(related.length ? { related } : {}) };
  });

/* ── Mute, report, who reacted, liked posts, hashtag suggestions ──────────────────────────────────── */

/** The Fedizen account id for a handle, or the id given. */
async function accountIdFor(token: string, v: { accountId?: string; acct?: string }): Promise<string | { error: Problem | 'not-found' }> {
  if (v.accountId) return v.accountId;
  const acct = v.acct ? lookupAcct(v.acct) : null;
  if (!acct) return { error: 'not-found' };
  const { fedizenGet } = await import('./fedizen.server');
  const found = await fedizenGet(token, `/api/v1/accounts/lookup?acct=${encodeURIComponent(acct)}`).catch(() => null);
  if (!found) return { error: 'unavailable' };
  if (found.status === 404 || (found.status === 200 && !found.data.length)) return { error: 'not-found' };
  if (found.status !== 200) return { error: problem(found.status) };
  return fromAccounts(found.data as never)[0]?.id ?? { error: 'not-found' };
}
const who = z.object({ accountId: statusId.optional(), acct: z.string().max(320).optional() }).refine(v => !!v.accountId || !!v.acct, 'who');

/** Mutes or unmutes someone: their posts leave your feeds, and you can still see them on their profile. */
export const muteFedizenAccount = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.and(who).and(z.object({ on: z.boolean() })).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: Problem | 'not-found' }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const id = await accountIdFor(c.token, data);
    if (typeof id !== 'string') return { ok: false, error: id.error };
    const { fedizenSend } = await import('./fedizen.server');
    const r = await fedizenSend(c.token, 'POST', `/api/v1/accounts/${id}/${data.on ? 'mute' : 'unmute'}`);
    return r.status >= 200 && r.status < 300 ? { ok: true } : { ok: false, error: problem(r.status) };
  });

/** People you mute. */
export const getMutedAccounts = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.parse(d))
  .handler(async ({ data, context }): Promise<{ people: FedizenPerson[]; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId);
    if ('error' in c) return { people: [], error: c.error };
    const { fedizenGet } = await import('./fedizen.server');
    const r = await fedizenGet(c.token, '/api/v1/mutes?limit=80').catch(() => null);
    return r?.status === 200 ? { people: fromAccounts(r.data as never) } : { people: [], error: r ? problem(r.status) : 'unavailable' };
  });

/** Reports an account, and optionally some of its posts, to Fedizen's moderators (Mastodon's report categories). */
export const reportOnFedizen = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.and(who).and(z.object({
    statusIds: z.array(statusId).max(20).default([]),
    comment: z.string().trim().max(1000).default(''),
    category: z.enum(['spam', 'legal', 'violation', 'other']),
    forward: z.boolean().default(false),
  })).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: Problem | 'not-found' }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId, true);
    if ('error' in c) return { ok: false, error: c.error };
    const id = await accountIdFor(c.token, data);
    if (typeof id !== 'string') return { ok: false, error: id.error };
    const { fedizenSend } = await import('./fedizen.server');
    const r = await fedizenSend(c.token, 'POST', '/api/v1/reports', {
      account_id: id, ...(data.statusIds.length ? { status_ids: data.statusIds } : {}), comment: data.comment, category: data.category, forward: data.forward,
    });
    return r.status >= 200 && r.status < 300 ? { ok: true } : { ok: false, error: problem(r.status) };
  });

/** Who liked or boosted a post (Mastodon favourited_by / reblogged_by). */
export const getWhoReacted = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ statusId, kind: z.enum(['like', 'boost']) }).parse(d))
  .handler(async ({ data, context }): Promise<{ people: (FedizenPerson & { acct?: string; actor?: string })[]; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId);
    if ('error' in c) return { people: [], error: c.error };
    const { fedizenGet } = await import('./fedizen.server');
    const { fullAcct } = await import('./fedizen-feed');
    const { isPublicHttpsUrl } = await import('./article-author');
    const r = await fedizenGet(c.token, `/api/v1/statuses/${data.statusId}/${data.kind === 'like' ? 'favourited_by' : 'reblogged_by'}?limit=40`).catch(() => null);
    if (!r || r.status !== 200) return { people: [], error: r ? problem(r.status) : 'unavailable' };
    const raw = r.data as { acct?: string; url?: string | null; uri?: string | null }[];
    return { people: fromAccounts(r.data as never).map((p, i) => {
      const acct = fullAcct(raw[i]?.acct), actor = [raw[i]?.uri, raw[i]?.url].find(u => isPublicHttpsUrl(u ?? undefined)) ?? undefined;
      return { ...p, ...(acct ? { acct } : {}), ...(actor ? { actor } : {}) };
    }) };
  });

/** Posts you liked, newest first (Mastodon /favourites). */
export const getLikedPosts = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.parse(d))
  .handler(async ({ data, context }): Promise<{ posts: FedizenPost[]; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId);
    if ('error' in c) return { posts: [], error: c.error };
    const { fedizenGet } = await import('./fedizen.server');
    const r = await fedizenGet(c.token, '/api/v1/favourites?limit=40').catch(() => null);
    return r?.status === 200 ? { posts: await withArticleAuthors(fromStatuses(r.data as never).map(p => ({ ...p, liked: true })), 2000, c.token) } : { posts: [], error: r ? problem(r.status) : 'unavailable' };
  });

/** Hashtags starting with what's typed after "#" (Mastodon v2 search, hashtags), for the composer. */
export const suggestHashtags = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ q: z.string().regex(/^[\p{L}\p{N}_]{1,100}$/u) }).parse(d))
  .handler(async ({ data, context }): Promise<{ tags: string[] }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const c = await connection(context.userId);
    if ('error' in c) return { tags: [] };
    const { fedizenGet } = await import('./fedizen.server');
    const r = await fedizenGet(c.token, `/api/v2/search?q=${encodeURIComponent(data.q)}&type=hashtags&limit=8`).catch(() => null);
    const tags = r?.status === 200 ? ((r.data[0] as { hashtags?: { name: string }[] } | undefined)?.hashtags ?? []).map(h => h.name) : [];
    // Those starting with what's typed first, as Mastodon's composer orders them.
    const q = data.q.toLowerCase();
    return { tags: [...new Set(tags)].sort((a, b) => Number(b.toLowerCase().startsWith(q)) - Number(a.toLowerCase().startsWith(q))).slice(0, 8) };
  });
