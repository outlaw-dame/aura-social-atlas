import { FEDIZEN, FEDIZEN_API_SCOPE } from './fedizen-feed';
import { z } from 'zod';

const b64url = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const admin = async () => (await import('@/integrations/supabase/client.server')).supabaseAdmin;

/**
 * Bounded JSON for the existing Fedizen REST and OAuth transports. All callers
 * use a trusted fixed endpoint; response data is untrusted until validated.
 * This implementation cancels both declared and streamed oversized bodies.
 */
export async function readBoundedFedizenJson(response: Response, maxBytes: number): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Fedizen response too large.');
  }
  if (!response.body) throw new Error('Missing Fedizen response body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Fedizen response too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

export function parseFedizenOAuthApp(payload: unknown): { client_id: string; client_secret: string } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const { client_id, client_secret } = payload as Record<string, unknown>;
  if (typeof client_id !== 'string' || !client_id || client_id.length > 4096 ||
    /[\r\n]/.test(client_id)) return null;
  if (typeof client_secret !== 'string' || !client_secret || client_secret.length > 8192 ||
    /[\r\n]/.test(client_secret)) return null;
  return { client_id, client_secret };
}

export async function registerFedizenOAuthApp(
  redirectUri: string,
  fetcher: typeof fetch = fetch,
): Promise<{ client_id: string; client_secret: string }> {
  const response = await fetcher(`${FEDIZEN}/api/v1/apps`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Atlas', redirect_uris: redirectUri,
      scopes: FEDIZEN_API_SCOPE, website: new URL(redirectUri).origin,
    }),
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
    cache: 'no-store',
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Fedizen OAuth app registration unavailable.');
  }
  const app = parseFedizenOAuthApp(await readBoundedFedizenJson(response, 32768));
  if (!app) throw new Error('Fedizen returned invalid OAuth app credentials.');
  return app;
}

async function appFor(redirectUri: string) {
  const db = await admin();
  // An app registered for fewer scopes can't be granted more, so the scopes it was registered with are kept
  // and a new app is registered when Atlas asks for different ones (migration 0004).
  const lookup = await db.from('fedizen_oauth_apps').select('client_id, client_secret, scopes').eq('redirect_uri', redirectUri).maybeSingle();
  // Until migration 0004 adds `scopes` (Postgres 42703, undefined column), keep the existing registration as-is:
  // connecting still works, and group joins ask to reconnect once the column exists.
  const legacy = lookup.error?.code === '42703';
  const { data, error: lookupError } = legacy
    ? await db.from('fedizen_oauth_apps').select('client_id, client_secret').eq('redirect_uri', redirectUri).maybeSingle()
    : lookup;
  if (lookupError) throw new Error('Could not read Fedizen OAuth app registration.');
  if (data && (legacy || (data as { scopes?: string }).scopes === FEDIZEN_API_SCOPE)) {
    const stored = parseFedizenOAuthApp(data);
    if (!stored) throw new Error('Stored Fedizen OAuth app credentials are invalid.');
    return stored;
  }
  const registered = await registerFedizenOAuthApp(redirectUri);
  const { error: registrationError } = await db.from('fedizen_oauth_apps').upsert(
    legacy ? { redirect_uri: redirectUri, ...registered } : { redirect_uri: redirectUri, ...registered, scopes: FEDIZEN_API_SCOPE },
  );
  if (registrationError) throw new Error('Could not persist Fedizen OAuth app registration.');
  return registered;
}

export async function startConnect(userId: string, redirectUri: string) {
  const app = await appFor(redirectUri);
  const state = random(24); const verifier = random(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const db = await admin();
  const { error: clearError } = await db.from('fedizen_oauth_states').delete().eq('user_id', userId);
  if (clearError) throw new Error('Could not clear previous Fedizen authorization state.');
  const { error: insertError } = await db.from('fedizen_oauth_states').insert({ state, user_id: userId, code_verifier: verifier, redirect_uri: redirectUri });
  if (insertError) throw new Error('Could not persist Fedizen authorization state.');
  const q = new URLSearchParams({ client_id: app.client_id, redirect_uri: redirectUri, response_type: 'code', scope: FEDIZEN_API_SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256' });
  return `${FEDIZEN}/oauth/authorize?${q}`;
}

/** Consume exactly one authorization state belonging to the authenticated user.
 * The DELETE + RETURNING is a single database operation: no cross-user
 * deletion (IDOR) and no replay race between two callbacks. */
export async function consumeOAuthState(db: Awaited<ReturnType<typeof admin>>, userId: string, state: string) {
  const { data, error } = await db.from('fedizen_oauth_states')
    .delete().eq('state', state).eq('user_id', userId).select('*').maybeSingle();
  if (error) throw new Error('Could not atomically consume Fedizen authorization state.');
  return data;
}


/**
 * Validate a delegated read grant before it is stored against an Atlas account.
 * The token endpoint may omit `scope`; if present it must include the requested
 * broad read grant. A successful verify_credentials read confirms the token
 * corresponds to a real Fedizen account, not that every API scope is available.
 */
export function parseFedizenReadGrant(payload: unknown): { access_token: string; scope: string } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const token = (payload as Record<string, unknown>).access_token;
  const scope = (payload as Record<string, unknown>).scope;
  if (typeof token !== 'string' || !token.trim() || token.length > 8192 || /[\r\n]/.test(token)) return null;
  // Atlas asks for "read write follow". Reading is required; whatever else Fedizen granted is stored as granted,
  // and each write checks for its own scope (an older read-only grant reconnects before joining a group).
  if (scope !== undefined && (typeof scope !== 'string' || scope.length > 512 ||
    !scope.split(/\s+/).includes('read'))) return null;
  return { access_token: token, scope: typeof scope === 'string' ? scope : FEDIZEN_API_SCOPE };
}

export function parseFedizenAccount(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const account = payload as Record<string, unknown>;
  // Account identity MUST be present before a grant can be associated with a
  // local Atlas account. Do not persist an unverified anonymous bearer.
  return typeof account.id === 'string' && account.id.length > 0 &&
    typeof account.acct === 'string' && account.acct.length > 0 &&
    account.acct.length <= 320 && !/[\s\r\n]/.test(account.acct)
    ? account.acct : null;
}

export async function verifyFedizenReadGrant(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetcher(`${FEDIZEN}/api/v1/accounts/verify_credentials`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const data = await readBoundedFedizenJson(response, 16384);
    return parseFedizenAccount(data);
  } catch {
    return null;
  }
}

/**
 * Single-attempt authorization-code redemption. A timeout is ambiguous, so
 * never automatically replay a code or send its verifier/secret to redirects.
 */
export async function redeemFedizenReadCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
  app: { client_id: string; client_secret: string },
  fetcher: typeof fetch = fetch,
): Promise<
  | { kind: 'ok'; grant: { access_token: string; scope: string } }
  | { kind: 'rejected' | 'invalid' | 'unavailable' }
> {
  let response: Response;
  try {
    response = await fetcher(`${FEDIZEN}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: redirectUri,
        client_id: app.client_id, client_secret: app.client_secret,
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    return { kind: 'unavailable' };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return { kind: 'rejected' };
  }
  try {
    const payload = await readBoundedFedizenJson(response, 32768);
    const grant = parseFedizenReadGrant(payload);
    return grant ? { kind: 'ok', grant } : { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
}

export async function finishConnect(userId: string, code: string, state: string) {
  const db = await admin();
  const st = await consumeOAuthState(db, userId, state);
  const age = st ? Date.now() - new Date(st.created_at).getTime() : NaN;
  if (!st || !Number.isFinite(age) || age < 0 || age > 15 * 60_000) return { ok: false as const, error: 'This connection link expired. Please try again.' };
  const app = await appFor(st.redirect_uri);
  const exchange = await redeemFedizenReadCode(code, st.redirect_uri, st.code_verifier, app);
  if (exchange.kind !== 'ok') {
    return {
      ok: false as const,
      error: exchange.kind === 'rejected' ? 'Fedizen didn’t accept the connection. Please try again.' :
        exchange.kind === 'invalid' ? 'Fedizen returned an invalid authorization response. Connect again.' :
        'Fedizen could not complete the connection. Please try again.',
    };
  }
  const { grant } = exchange;
  const handle = await verifyFedizenReadGrant(grant.access_token);
  if (!handle) return { ok: false as const, error: 'Fedizen could not verify the connected account. Connect again.' };
  const { error: saveError } = await db.from('fedizen_connections').upsert({ user_id: userId, access_token: grant.access_token, scope: grant.scope, account_handle: handle });
  if (saveError) throw new Error('Could not save Fedizen connection.');
  return { ok: true as const };
}

export async function connectionFor(
  db: Awaited<ReturnType<typeof admin>>,
  userId: string,
) {
  const { data, error } = await db.from('fedizen_connections')
    .select('access_token, account_handle, scope').eq('user_id', userId).maybeSingle();
  if (error) throw new Error('Could not read Fedizen connection.');
  return data;
}

export async function tokenFor(userId: string) {
  return connectionFor(await admin(), userId);
}

export async function disconnect(userId: string): Promise<void> {
  const db = await admin();
  const { error } = await db.from('fedizen_connections').delete().eq('user_id', userId);
  if (error) throw new Error('Could not disconnect Fedizen account.');
}

/** Server-side schema projection for each private endpoint Atlas reads.
 * Reject malformed nested objects instead of crashing the personal timeline,
 * and strip unknown fields before they reach UI normalizers. */
const account = z.object({
  id: z.string().max(64).nullish(),
  display_name: z.string().nullish(),
  username: z.string().nullish(),
  acct: z.string().nullish(),
  avatar: z.string().nullish(),
});
const media = z.object({
  type: z.string().nullish(),
  url: z.string().nullish(),
  preview_url: z.string().nullish(),
  // For videos: Bonfire's copy may be a remote file, with its duration and frame size in meta.
  remote_url: z.string().max(2048).nullish().catch(null),
  description: z.string().max(1500).nullish().catch(null),
  meta: z.object({
    duration: z.union([z.number(), z.string().max(40)]).nullish().catch(null),
    original: z.object({ width: z.number().nullish(), height: z.number().nullish() }).partial().nullish().catch(null),
  }).partial().nullish().catch(null),
});
const status = z.object({
  id: z.string().min(1),
  url: z.string().nullish(),
  uri: z.string().nullish(),
  created_at: z.string().nullish(),
  content: z.string().nullish(),
  account: account.nullish(),
  media_attachments: z.array(media).nullish(),
  bookmarked: z.boolean().nullish(),
  // Counts and the person's own reactions (Bonfire's status mapper fills all five); each fails on its own to null.
  replies_count: z.number().int().min(0).nullish().catch(null),
  reblogs_count: z.number().int().min(0).nullish().catch(null),
  favourites_count: z.number().int().min(0).nullish().catch(null),
  favourited: z.boolean().nullish().catch(null),
  reblogged: z.boolean().nullish().catch(null),
  visibility: z.enum(['public', 'unlisted', 'private', 'direct']).nullish().catch(null),
  /** The link preview Bonfire builds for the post's first link (no `authors`: Atlas works those out itself). */
  // Each field fails on its own (to null), so one odd preview never empties a feed.
  card: z.object({
    url: z.string().max(2048).nullish().catch(null),
    title: z.string().max(500).nullish().catch(null),
    provider_name: z.string().max(200).nullish().catch(null),
    author_name: z.string().max(200).nullish().catch(null),
    author_url: z.string().max(2048).nullish().catch(null),
    description: z.string().max(1000).nullish().catch(null),
    image: z.string().max(2048).nullish().catch(null),
  }).nullish().catch(null),
});
// The REST client only reads one reblog level. Avoid unbounded recursion.
const timelineStatus = status.extend({ reblog: status.nullish() });
const notice = z.object({
  id: z.string().min(1),
  type: z.string().nullish(),
  created_at: z.string().nullish(),
  account: account.nullish(),
  status: timelineStatus.nullish(),
});
const homeSchema = z.array(timelineStatus).max(20);
const notificationsSchema = z.array(notice).max(20);
/** Mastodon Relationship (Bonfire answers it for groups too; members follow their groups). */
const relationship = z.object({
  id: z.string().min(1).max(64),
  following: z.boolean().nullish(),
  requested: z.boolean().nullish(),
});
const relationshipsSchema = z.array(relationship).max(40);
/** Mastodon Conversation (Bonfire v1.1.0-rc.1: bonfire_api_graphql masto_compatible_router, GET /conversations). */
const conversation = z.object({
  id: z.string().min(1),
  unread: z.boolean().nullish(),
  accounts: z.array(account).max(50).nullish(),
  last_status: status.nullish(),
});
const conversationsSchema = z.array(conversation).max(30);
/** Bookmarks (Bonfire: MastoTimelineController.bookmarks, the "bookmarks" feed), newest first. */
const bookmarksSchema = z.array(timelineStatus).max(40);
/** Mastodon Lists, which Bonfire serves from Circles (bonfire_boundaries MastoListController). */
const list = z.object({ id: z.string().min(1).max(64), title: z.string().max(200).nullish() });
const listsSchema = z.array(list).max(200);
const accountsSchema = z.array(account.extend({ id: z.string().min(1).max(64) })).max(80);

const ID = '[A-Za-z0-9_-]{1,64}';
/** A hashtag, percent-encoded (letters in any script arrive as %XX). */
// A followed tag's name is at most 100 characters; percent-encoded, a 4-byte UTF-8 character takes 12.
const TAG = '[A-Za-z0-9_%]{1,1200}';
const followedTagsSchema = z.array(z.object({ name: z.string().min(1).max(100) })).max(20);
/** Every private read Atlas makes, each with the schema its answer must match. Anything else is refused. */
const ACCT = '[A-Za-z0-9_.%-]{1,64}(%40[A-Za-z0-9.-]{1,253})?';
const READS: { match: RegExp; schema: z.ZodType<unknown> ; single?: true }[] = [
  { match: /^\/api\/v1\/timelines\/home\?limit=20$/, schema: homeSchema },
  { match: /^\/api\/v1\/notifications\?limit=20$/, schema: notificationsSchema },
  { match: /^\/api\/v1\/conversations\?limit=30$/, schema: conversationsSchema },
  { match: new RegExp(`^/api/v1/accounts/relationships\\?id%5B%5D=${ID}(&id%5B%5D=${ID}){0,39}$`), schema: relationshipsSchema },
  { match: /^\/api\/v1\/bookmarks\?limit=40$/, schema: bookmarksSchema },
  { match: /^\/api\/v1\/lists$/, schema: listsSchema },
  // People you block (Bonfire: MastoAccountController.blocks, people both ghosted and silenced). Instances aren't in it.
  { match: /^\/api\/v1\/blocks\?limit=80$/, schema: accountsSchema },
  { match: new RegExp(`^/api/v1/lists/${ID}/accounts\\?limit=80$`), schema: accountsSchema },
  // One account by handle, to add someone to a circle. Answers a single Account, returned here as a one-item list.
  { match: new RegExp(`^/api/v1/accounts/lookup\\?acct=${ACCT}$`), schema: account.extend({ id: z.string().min(1).max(64) }), single: true },
  // People whose name or handle starts with what's typed after "@" in a reply (mention suggestions).
  { match: new RegExp(`^/api/v1/accounts/search\\?q=${ACCT}&limit=6$`), schema: z.array(account.extend({ id: z.string().min(1).max(64) })).max(40) },
  // For You: the hashtags you follow (Bonfire: MastoTagController.followed), and each one's timeline.
  { match: /^\/api\/v1\/followed_tags\?limit=20$/, schema: followedTagsSchema },
  { match: new RegExp(`^/api/v1/timelines/tag/${TAG}\\?limit=10$`), schema: homeSchema },
  // A circle's timeline (Bonfire: MastoListController.list_timeline over Circles), for circles pinned to Feeds.
  { match: new RegExp(`^/api/v1/timelines/list/${ID}\\?limit=20$`), schema: homeSchema },
  // One post, as the person sees it (their like, boost and bookmark, its counts): for group posts read publicly.
  { match: new RegExp(`^/api/v1/statuses/${ID}$`), schema: timelineStatus, single: true },
];

const MAX_PRIVATE_READ_BYTES = 2 * 1024 * 1024;

export async function fedizenGet(token: string, path: string): Promise<{ status: number; data: unknown[] }> {
  const read = READS.find(r => r.match.test(path));
  if (!read) throw new Error('Unsupported Fedizen read path.');

  let response: Response;
  try {
    response = await fetch(`${FEDIZEN}${path}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    return { status: 503, data: [] };
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return { status: response.status, data: [] };
  }

  let payload: unknown;
  try {
    payload = await readBoundedFedizenJson(response, MAX_PRIVATE_READ_BYTES);
  } catch {
    // Includes decode, timeout/stream, oversize and malformed JSON failures.
    // Do not log bearer values or private response bodies.
    return { status: 502, data: [] };
  }
  const parsed = read.schema.safeParse(payload);
  if (!parsed.success) return { status: 502, data: [] };
  return { status: 200, data: read.single ? [parsed.data] : parsed.data as unknown[] };
}

/**
 * The writes Atlas makes as the person, and nothing else:
 * - join or leave a Bonfire group (/api/v1-bonfire/groups/:id/join|leave); follow or unfollow an account;
 * - bookmark, like or boost a post, and undo each; reply to a post; block or unblock a person (Moderation);
 * - create, rename and delete a circle, and add or remove its members (Mastodon Lists, served from Bonfire Circles).
 * Each route names its method and the only body it may carry. Same transport rules as reads: fixed host,
 * no redirects, no caching, bounded reply, nothing logged.
 */
const title = z.object({ title: z.string().trim().min(1).max(100) }).strict();
/** A reply, and nothing else: Atlas only posts in answer to a post, in that post's audience or a narrower one. */
const reply = z.object({
  status: z.string().trim().min(1).max(5000),
  in_reply_to_id: z.string().regex(new RegExp(`^${ID}$`)),
  visibility: z.enum(['public', 'unlisted', 'private', 'direct']),
}).strict();
const members = z.object({ account_ids: z.array(z.string().regex(new RegExp(`^${ID}$`))).min(1).max(20) }).strict();
const WRITES: { method: 'POST' | 'PUT' | 'DELETE'; match: RegExp; body?: z.ZodTypeAny }[] = [
  { method: 'POST', match: new RegExp(`^/api/v1-bonfire/groups/${ID}/(join|leave)$`) },
  { method: 'POST', match: new RegExp(`^/api/v1/accounts/${ID}/(follow|unfollow)$`) },
  { method: 'POST', match: new RegExp(`^/api/v1/statuses/${ID}/(bookmark|unbookmark|favourite|unfavourite|reblog|unreblog)$`) },
  { method: 'POST', match: /^\/api\/v1\/statuses$/, body: reply },
  { method: 'POST', match: new RegExp(`^/api/v1/accounts/${ID}/(block|unblock)$`) },
  { method: 'POST', match: /^\/api\/v1\/lists$/, body: title },
  { method: 'PUT', match: new RegExp(`^/api/v1/lists/${ID}$`), body: title },
  { method: 'DELETE', match: new RegExp(`^/api/v1/lists/${ID}$`) },
  { method: 'POST', match: new RegExp(`^/api/v1/lists/${ID}/accounts$`), body: members },
  { method: 'DELETE', match: new RegExp(`^/api/v1/lists/${ID}/accounts$`), body: members },
];
const writeReply = z.object({
  id: z.string().max(64).nullish(),
  title: z.string().max(200).nullish(),
  following: z.boolean().nullish(),
  requested: z.boolean().nullish(),
  bookmarked: z.boolean().nullish(),
  favourited: z.boolean().nullish(),
  reblogged: z.boolean().nullish(),
  favourites_count: z.number().int().min(0).nullish(),
  reblogs_count: z.number().int().min(0).nullish(),
  url: z.string().max(2048).nullish(),
  /** Boosting answers with the boost, which wraps the post (whose flags and counts are what changed). */
  reblog: z.object({ reblogged: z.boolean().nullish(), reblogs_count: z.number().int().min(0).nullish() }).nullish(),
  group: z.object({ member: z.boolean().nullish() }).nullish(),
});

export async function fedizenSend(token: string, method: 'POST' | 'PUT' | 'DELETE', path: string, body?: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> | null }> {
  const route = WRITES.find(w => w.method === method && w.match.test(path));
  if (!route) throw new Error('Unsupported Fedizen write path.');
  if (!route.body !== !body) throw new Error('Unsupported Fedizen write body.');
  const payload = route.body ? route.body.safeParse(body) : null;
  if (payload && !payload.success) throw new Error('Unsupported Fedizen write body.');
  let response: Response;
  try {
    response = await fetch(`${FEDIZEN}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(payload ? { 'content-type': 'application/json' } : {}) },
      body: payload ? JSON.stringify(payload.data) : undefined,
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    return { status: 503, data: null };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return { status: response.status, data: null };
  }
  try {
    const parsed = writeReply.safeParse(await readBoundedFedizenJson(response, 65536));
    return { status: response.status, data: parsed.success ? parsed.data : null };
  } catch {
    // A 2xx with an empty or unreadable body (DELETE answers {}): the write happened, so report success without state.
    return { status: response.status, data: null };
  }
}
