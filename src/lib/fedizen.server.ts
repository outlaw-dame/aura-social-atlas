import { forgetMicrocache, microcached, reuseFor } from './fedizen-microcache';
import { BREAKER, mayAskFedizen, noteFedizenAnswered, noteFedizenTimeout, noteFedizenUnreached } from './fedizen-breaker';
import { FEDIZEN_USER_AGENT, transportDetail, type FedizenTransportFailure } from './fedizen-http';
import { FEDIZEN, FEDIZEN_API_SCOPE } from './fedizen-feed';
import { accountKey, cachedStatus, forgetAccountReads, keepStatus, noteRateLimited, waitLeft } from './fedizen-rate-limit';
import { z } from 'zod';

const b64url = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const admin = async () => (await import('@/integrations/supabase/client.server')).supabaseAdmin;

/** Only fixed, non-sensitive failure stages may cross the server logging boundary. */
export type ConnectFailureStage = 'storage' | 'registration-network' | 'registration-http' | 'registration-response';
export class FedizenConnectError extends Error {
  constructor(
    public readonly stage: ConnectFailureStage,
    public readonly httpStatus?: number,
    public readonly transport?: FedizenTransportFailure,
  ) {
    super(stage === 'registration-response' ? 'Fedizen returned invalid OAuth app credentials.' :
      stage === 'registration-http' ? 'Fedizen OAuth app registration unavailable.' :
      stage === 'registration-network' ? 'Fedizen OAuth app registration network unavailable.' :
      'Atlas could not prepare the Fedizen connection.');
    this.name = 'FedizenConnectError';
  }
}


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
  let response: Response;
  try {
    response = await fetcher(`${FEDIZEN}/api/v1/apps`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': FEDIZEN_USER_AGENT },
      body: JSON.stringify({
        client_name: 'Atlas', redirect_uris: redirectUri,
        scopes: FEDIZEN_API_SCOPE, website: new URL(redirectUri).origin,
      }),
      signal: AbortSignal.timeout(10000),
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch (e) {
    throw new FedizenConnectError('registration-network', undefined, transportDetail(e));
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new FedizenConnectError('registration-http', response.status);
  }
  let app: ReturnType<typeof parseFedizenOAuthApp>;
  try { app = parseFedizenOAuthApp(await readBoundedFedizenJson(response, 32768)); }
  catch { throw new FedizenConnectError('registration-response'); }
  if (!app) throw new FedizenConnectError('registration-response');
  return app;
}

async function appFor(redirectUri: string) {
  const db = await admin().catch(() => { throw new FedizenConnectError('storage'); });
  // An app registered for fewer scopes can't be granted more, so the scopes it was registered with are kept
  // and a new app is registered when Atlas asks for different ones (migration 0004).
  const lookup = await db.from('fedizen_oauth_apps').select('client_id, client_secret, scopes').eq('redirect_uri', redirectUri).maybeSingle();
  // Until migration 0004 adds `scopes` (Postgres 42703, undefined column), keep the existing registration as-is:
  // connecting still works, and group joins ask to reconnect once the column exists.
  const legacy = lookup.error?.code === '42703';
  const { data, error: lookupError } = legacy
    ? await db.from('fedizen_oauth_apps').select('client_id, client_secret').eq('redirect_uri', redirectUri).maybeSingle()
    : lookup;
  if (lookupError) throw new FedizenConnectError('storage');
  if (data && (legacy || (data as { scopes?: string }).scopes === FEDIZEN_API_SCOPE)) {
    const stored = parseFedizenOAuthApp(data);
    if (!stored) throw new FedizenConnectError('storage');
    return stored;
  }
  const registered = await registerFedizenOAuthApp(redirectUri);
  const { error: registrationError } = await db.from('fedizen_oauth_apps').upsert(
    legacy ? { redirect_uri: redirectUri, ...registered } : { redirect_uri: redirectUri, ...registered, scopes: FEDIZEN_API_SCOPE },
  );
  if (registrationError) throw new FedizenConnectError('storage');
  return registered;
}

export async function startConnect(userId: string, redirectUri: string) {
  const app = await appFor(redirectUri);
  const state = random(24); const verifier = random(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const db = await admin().catch(() => { throw new FedizenConnectError('storage'); });
  const { error: clearError } = await db.from('fedizen_oauth_states').delete().eq('user_id', userId);
  if (clearError) throw new FedizenConnectError('storage');
  const { error: insertError } = await db.from('fedizen_oauth_states').insert({ state, user_id: userId, code_verifier: verifier, redirect_uri: redirectUri });
  if (insertError) throw new FedizenConnectError('storage');
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

async function readVerifiedFedizenPayload(token: string, fetcher: typeof fetch): Promise<unknown | null> {
  try {
    const response = await fetcher(`${FEDIZEN}/api/v1/accounts/verify_credentials`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': FEDIZEN_USER_AGENT },
      signal: AbortSignal.timeout(10000),
      redirect: 'manual',
      cache: 'no-store',
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    return await readBoundedFedizenJson(response, 16384);
  } catch {
    return null;
  }
}

/** Verify the delegated grant's own account, preserving the original handle
 * representation used when the connection was first persisted. */
export async function verifyFedizenReadGrant(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  return parseFedizenAccount(await readVerifiedFedizenPayload(token, fetcher));
}

/** UI-safe fields only, sourced directly from the authenticated social provider. */
export async function readVerifiedFedizenViewer(
  token: string,
  fetcher: typeof fetch = fetch,
) {
  const payload = await readVerifiedFedizenPayload(token, fetcher);
  if (!parseFedizenAccount(payload)) return null;
  const { parseFedizenViewer } = await import('./fedizen-viewer');
  return parseFedizenViewer(payload);
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
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': FEDIZEN_USER_AGENT },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: redirectUri,
        client_id: app.client_id, client_secret: app.client_secret,
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(10000),
      redirect: 'manual',
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
  const row = { user_id: userId, access_token: grant.access_token, scope: grant.scope, account_handle: handle };
  // Remember the issuing app so Disconnect can revoke with it (migration 0005); without the column, save as before.
  let { error: saveError } = await db.from('fedizen_connections').upsert({ ...row, client_id: app.client_id });
  if (saveError?.code === '42703') ({ error: saveError } = await db.from('fedizen_connections').upsert(row));
  forgetConnection(userId);
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

/**
 * The person's Fedizen connection, kept for CONNECTION_MS: every server function needs it, and a page asks for
 * several at once (Home, For You, notifications, circles…), each of which used to read it from Supabase again. Only
 * in this server's memory, never shared between people, and forgotten at once when the person connects or
 * disconnects here (forgetConnection), so a disconnect takes effect on the next request. (With more than one replica,
 * another replica could keep using a just-disconnected token for up to CONNECTION_MS; Fedizen has revoked it by then.)
 */
const CONNECTION_MS = 15_000;
const connections = new Map<string, { until: number; value: ReturnType<typeof connectionFor> }>();
export async function tokenFor(userId: string) {
  const hit = connections.get(userId);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = admin().then(db => connectionFor(db, userId));
  connections.set(userId, { until: Date.now() + CONNECTION_MS, value });
  if (connections.size > 1000) connections.delete(connections.keys().next().value!);
  value.catch(() => { if (connections.get(userId)?.value === value) connections.delete(userId); });
  return value;
}
/** This person's connection changed: read it again next time. */
export function forgetConnection(userId: string) { connections.delete(userId); }

/**
 * Asks Fedizen to revoke a token (RFC 7009: POST /oauth/revoke with the issuing client's credentials; Bonfire serves
 * it through Boruta, bonfire_open_id lib/web/routes.ex), trying the given registrations in order until one is
 * accepted. Best-effort: true once Fedizen confirms.
 */
export async function revokeFedizenToken(
  token: string,
  apps: { client_id: string; client_secret: string }[],
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  for (const app of apps) {
    try {
      const response = await fetcher(`${FEDIZEN}/oauth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': FEDIZEN_USER_AGENT },
        body: new URLSearchParams({ token, token_type_hint: 'access_token', client_id: app.client_id, client_secret: app.client_secret }),
        signal: AbortSignal.timeout(8000),
        redirect: 'manual',
        cache: 'no-store',
      });
      await response.body?.cancel().catch(() => {});
      if (response.ok) return true;
    } catch { /* try the next registration; the stored copy is deleted regardless */ }
  }
  return false;
}

type OAuthApp = { client_id: string; client_secret: string };
const parseApps = (rows: unknown[] | null) => (rows ?? []).map(parseFedizenOAuthApp).filter((a): a is OAuthApp => !!a);

/**
 * The registration that issued a user's grant (recorded since migration 0005). A connection from before then, or a
 * database without the column, gets every registration, newest first — none left out, so no grant stays live.
 */
async function issuingApps(db: Awaited<ReturnType<typeof admin>>, userId: string): Promise<OAuthApp[]> {
  const { data: rec, error } = await db.from('fedizen_connections').select('client_id').eq('user_id', userId).maybeSingle();
  const clientId = !error && typeof (rec as { client_id?: unknown } | null)?.client_id === 'string' ? (rec as { client_id: string }).client_id : null;
  if (clientId) {
    const { data } = await db.from('fedizen_oauth_apps').select('client_id, client_secret').eq('client_id', clientId).limit(1);
    const own = parseApps(data);
    if (own.length) return own;
  }
  const all: OAuthApp[] = [];
  for (let from = 0; ; from += 100) {
    const { data, error: pageError } = await db.from('fedizen_oauth_apps').select('client_id, client_secret')
      .order('created_at', { ascending: false }).range(from, from + 99);
    if (pageError || !data?.length) break;
    all.push(...parseApps(data));
    if (data.length < 100) break;
  }
  return all;
}

/**
 * Disconnects Fedizen: revokes the grant at Fedizen, so the token stops working there too, then deletes Atlas's copy.
 * The local copy goes even if Fedizen can't be reached; the person can still revoke Atlas in Fedizen's settings.
 */
export async function disconnect(userId: string): Promise<{ revoked: boolean }> {
  const db = await admin();
  const conn = await connectionFor(db, userId).catch(() => null);
  let revoked = false;
  if (conn?.access_token) revoked = await revokeFedizenToken(conn.access_token, await issuingApps(db, userId));
  forgetConnection(userId);
  const { error } = await db.from('fedizen_connections').delete().eq('user_id', userId);
  forgetConnection(userId); // and again, in case a read landed in between
  if (error) throw new Error('Could not disconnect Fedizen account.');
  return { revoked };
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
  // Preserve explicit opt-out from account discoverability for Spotlight.
  discoverable: z.boolean().nullish().catch(null),
  // The actor (Bonfire gives its id as `url`; Mastodon adds `uri`), so a name opens the profile in Atlas.
  url: z.string().max(2048).nullish().catch(null),
  uri: z.string().max(2048).nullish().catch(null),
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
    // The preview's size (Mastodon: meta.small), used to reserve an image's space before it loads.
    small: z.object({ width: z.number().nullish(), height: z.number().nullish() }).partial().nullish().catch(null),
  }).partial().nullish().catch(null),
});
const pollSchema = z.object({
  id: z.string().min(1).max(64),
  expires_at: z.string().max(40).nullish().catch(null),
  expired: z.boolean().nullish().catch(null),
  multiple: z.boolean().nullish().catch(null),
  votes_count: z.number().int().min(0).nullish().catch(null),
  voters_count: z.number().int().min(0).nullish().catch(null),
  voted: z.boolean().nullish().catch(null),
  own_votes: z.array(z.number().int().min(0).max(100)).max(100).nullish().catch(null),
  options: z.array(z.object({ title: z.string().max(5000), votes_count: z.number().int().min(0).nullish().catch(null) })).max(100),
});
const status = z.object({
  id: z.string().min(1),
  url: z.string().nullish(),
  uri: z.string().nullish(),
  created_at: z.string().nullish(),
  content: z.string().nullish(),
  account: account.nullish(),
  media_attachments: z.array(media).nullish(),
  /** The author marked the media sensitive: shown behind a veil. */
  sensitive: z.boolean().nullish().catch(null),
  bookmarked: z.boolean().nullish(),
  // Counts and the person's own reactions (Bonfire's status mapper fills all five); each fails on its own to null.
  replies_count: z.number().int().min(0).nullish().catch(null),
  reblogs_count: z.number().int().min(0).nullish().catch(null),
  favourites_count: z.number().int().min(0).nullish().catch(null),
  favourited: z.boolean().nullish().catch(null),
  reblogged: z.boolean().nullish().catch(null),
  visibility: z.enum(['public', 'unlisted', 'private', 'direct']).nullish().catch(null),
  /** The post this one replies to, shown above it in feeds (fetched from Fedizen as the reader may see it). */
  in_reply_to_id: z.string().max(64).nullish().catch(null),
  /** Whose post that is: a reply to the reader's own post is a reply to them (Activity's "replied to you"). */
  in_reply_to_account_id: z.string().max(64).nullish().catch(null),
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
  // What keyword filters read besides the text (each fails on its own to null).
  spoiler_text: z.string().max(1000).nullish().catch(null),
  tags: z.array(z.object({ name: z.string().max(100) })).max(50).nullish().catch(null),
  // Whom the post mentions, as Fedizen resolved them: "@name" in the text opens theirs in Atlas.
  mentions: z.array(z.object({ acct: z.string().max(320).nullish(), username: z.string().max(320).nullish() })).max(50).nullish().catch(null),
  // Mastodon Poll (Bonfire: bonfire_poll's Mappers.Poll): its options and counts, and whether the reader voted.
  poll: pollSchema.nullish().catch(null),
  // Its custom emoji (Mastodon CustomEmoji), drawn in its text by shortcode; https images only, checked again when read.
  emojis: z.array(z.object({ shortcode: z.string().max(64), url: z.string().max(2048), static_url: z.string().max(2048).nullish().catch(null) })).max(100).nullish().catch(null),
  /** When the author last edited it (Mastodon), for the "Edited" mark. */
  edited_at: z.string().max(40).nullish().catch(null),
  /** The language its author wrote it in (Mastodon: ISO 639), for translation. */
  language: z.string().max(35).nullish().catch(null),
  // Mastodon 4.5 quotes: { state, quoted_status }. Only the quoted post's own words, never deeper.
  quote: z.object({
    quoted_status: z.object({
      content: z.string().max(20_000).nullish().catch(null),
      spoiler_text: z.string().max(1000).nullish().catch(null),
      media_attachments: z.array(z.object({ description: z.string().max(1500).nullish().catch(null) })).max(20).nullish().catch(null),
    }).nullish().catch(null),
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
/** Statuses where any one that doesn't fit is dropped, for long lists from many servers (a conversation). */
const tolerantStatuses = z.array(z.unknown()).max(4096).transform(list => list.flatMap(x => { const r = timelineStatus.safeParse(x); return r.success ? [r.data] : []; }));
const notificationsSchema = z.array(notice).max(20);
/** Mastodon 4.3 grouped notifications (Bonfire: SocialMastoAdapter.grouped_notifications, groups within a page). */
const groupedSchema = z.object({
  accounts: z.array(account.extend({ id: z.string().min(1).max(64) })).max(400).nullish().catch(null),
  statuses: z.array(timelineStatus).max(80).nullish().catch(null),
  notification_groups: z.array(z.object({
    group_key: z.string().min(1).max(200),
    notifications_count: z.number().int().nonnegative().nullish().catch(null),
    type: z.string().max(64).nullish(),
    latest_page_notification_at: z.string().max(64).nullish().catch(null),
    /** The newest notification in the group (a string; Mastodon's docs once showed a number), for read and unread. */
    most_recent_notification_id: z.union([z.string().max(64), z.number().int().nonnegative()]).nullish().catch(null),
    sample_account_ids: z.array(z.string().max(64)).max(400).nullish().catch(null),
    status_id: z.string().max(64).nullish().catch(null),
    /** Mastodon 4.6: the collection behind added_to_collection / collection_update; only its page URL is kept. */
    collection: z.object({ url: z.string().max(500).nullish().catch(null) }).nullish().catch(null),
  })).max(80),
});
/** Mastodon Marker for notifications: the last one read. Bonfire answers {} when there is none yet. */
const markersSchema = z.object({
  notifications: z.object({ last_read_id: z.string().max(64).nullish().catch(null), updated_at: z.string().max(64).nullish().catch(null) }).nullish().catch(null),
});
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
const listedAccount = account.extend({ id: z.string().min(1).max(64) });
/**
 * Follow requests: Bonfire (rc.1, GraphQLMasto.Adapter.list_follow_requests) ignores `limit` and returns every pending
 * request, so the list can be any length (the byte cap still bounds it); an entry Atlas can't read is left out rather
 * than failing the whole list.
 */
const followRequestsSchema = z.array(z.unknown()).max(10_000)
  .transform(items => items.flatMap(i => { const a = listedAccount.safeParse(i); return a.success ? [a.data] : []; }));
/**
 * Blocked and muted people: Bonfire (rc.1) returns the whole list whatever `limit` asks (seen live: more than 80 came
 * back for limit=80 and failed the bounded schema), so these take every entry, as follow requests do. Settings shows
 * the whole list, and Muted needs every block to leave blocked people out.
 */
// Existing Blocked/Muted settings intentionally tolerate malformed single
// accounts, so the user can still manage the rest. Discovery needs a STRICT
// separate view; never use a tolerant list for personalized recommendation.
const moderationListSchema = followRequestsSchema;
const completeModerationSchema = z.array(listedAccount.extend({
  acct: z.string().min(1).max(320),
})).max(10_000);

const ID = '[A-Za-z0-9_-]{1,64}';
/** A hashtag, percent-encoded (letters in any script arrive as %XX). */
// A followed tag's name is at most 100 characters; percent-encoded, a 4-byte UTF-8 character takes 12.
const TAG = '[A-Za-z0-9_%]{1,1200}';
const followedTagsSchema = z.array(z.object({ name: z.string().min(1).max(100) })).max(200);
/** Every private read Atlas makes, each with the schema its answer must match. Anything else is refused. */
const ACCT = '[A-Za-z0-9_.%-]{1,64}(%40[A-Za-z0-9.-]{1,253})?';
const instanceSchema = z.object({
  configuration: z.object({
    statuses: z.object({ max_characters: z.number().int().positive().nullish().catch(null) }).partial().nullish().catch(null),
    media_attachments: z.object({
      image_size_limit: z.number().positive().nullish().catch(null),
      video_size_limit: z.number().positive().nullish().catch(null),
    }).partial().nullish().catch(null),
  }).partial().nullish().catch(null),
});
const READS: { match: RegExp; schema: z.ZodType<unknown> ; single?: true }[] = [
  { match: /^\/api\/v1\/timelines\/home\?limit=20$/, schema: homeSchema },
  // The public federated timeline is not anonymous on Fedizen (live: 401).
  // Read with this user's grant only, then explicitly retain PUBLIC items for
  // Spotlight. Never expose an unlisted/private/DM item through discovery.
  { match: /^\/api\/v1\/timelines\/public\?limit=20$/, schema: homeSchema },
  // Fedizen-local PUBLIC discovery only; isolated to the authenticated owner
  // because the deployed public route may reject anonymous callers.
  { match: /^\/api\/v1\/timelines\/local\?limit=20$/, schema: homeSchema },
  // Older pages of Local, as the person reads it in Feeds (Bonfire: MastoTimelineController.local).
  { match: /^\/api\/v1\/timelines\/local\?limit=20&max_id=[A-Za-z0-9_\-.~=%]{1,512}$/, schema: homeSchema },
  // Exactly one optional older public page for owner-bound Spotlight sampling.
  // Never accept an arbitrary URL, hostname, cursor length or private feed.
  { match: /^\/api\/v1\/timelines\/public\?limit=20&max_id=[A-Za-z0-9_\-.~=%]{1,512}$/, schema: homeSchema },
  // The next (older) page of Home, from the cursor Fedizen's Link header gave (rel="next", max_id).
  { match: /^\/api\/v1\/timelines\/home\?limit=20&max_id=[A-Za-z0-9_\-.~=%]{1,512}$/, schema: homeSchema },
  { match: /^\/api\/v1\/notifications\?limit=20$/, schema: notificationsSchema },
  // Grouped notifications for Activity: all of them, or one tab's kinds (Replies: mention, status, quote; Follows:
  // follow, follow_request), then older pages.
  { match: /^\/api\/v2\/notifications\?limit=40(&types%5B%5D=(mention|status|quote|follow|follow_request)){0,5}(&max_id=[A-Za-z0-9_\-.~=%]{1,512})?$/, schema: groupedSchema, single: true },
  // Where the reader stopped reading notifications (Mastodon markers; Bonfire: MarkersController over its Seen edges).
  { match: /^\/api\/v1\/markers\?timeline%5B%5D=notifications$/, schema: markersSchema, single: true },
  { match: /^\/api\/v1\/conversations\?limit=30$/, schema: conversationsSchema },
  { match: new RegExp(`^/api/v1/accounts/relationships\\?id%5B%5D=${ID}(&id%5B%5D=${ID}){0,39}$`), schema: relationshipsSchema },
  { match: /^\/api\/v1\/bookmarks\?limit=40$/, schema: bookmarksSchema },
  { match: /^\/api\/v1\/lists$/, schema: listsSchema },
  // People you block (Bonfire: MastoAccountController.blocks, people both ghosted and silenced). Instances aren't in it.
  { match: /^\/api\/v1\/blocks\?limit=80$/, schema: moderationListSchema },
  // Owner-bound complete-list pagination for Spotlight only. Always use the
  // same fixed host and bounded opaque cursor; no caller-supplied URL.
  { match: /^\/api\/v1\/blocks\?limit=80&max_id=[A-Za-z0-9_\-.~=%]{1,512}$/, schema: moderationListSchema },
  { match: new RegExp(`^/api/v1/lists/${ID}/accounts\\?limit=80$`), schema: accountsSchema },
  // Which of your circles someone is in (Bonfire circles_containing_subject).
  { match: new RegExp(`^/api/v1/accounts/${ID}/lists$`), schema: listsSchema },
  // Who the person follows, a page at a time (fedibuzz-follows.server.ts: which of them are FediBuzz relays).
  { match: new RegExp(`^/api/v1/accounts/${ID}/following\\?limit=80(&max_id=[A-Za-z0-9_\\-.~=%]{1,512})?$`), schema: accountsSchema },
  // One account by handle, to add someone to a circle. Answers a single Account, returned here as a one-item list.
  { match: new RegExp(`^/api/v1/accounts/lookup\\?acct=${ACCT}$`), schema: account.extend({ id: z.string().min(1).max(64) }), single: true },
  // People whose name or handle starts with what's typed after "@" in a reply (mention suggestions).
  { match: new RegExp(`^/api/v1/accounts/search\\?q=${ACCT}&limit=6$`), schema: z.array(account.extend({ id: z.string().min(1).max(64) })).max(40) },
  // For You: the hashtags you follow (Bonfire: MastoTagController.followed), and each one's timeline.
  // 200 is Bonfire's (and Mastodon's) maximum page: the Followed hashtags list in Settings reads one full page.
  { match: /^\/api\/v1\/followed_tags\?limit=(20|100|200)$/, schema: followedTagsSchema },
  // …then older pages of each, by the cursor Fedizen's Link header gave (For You, a hashtag's feed).
  { match: new RegExp(`^/api/v1/timelines/tag/${TAG}\\?limit=(10|20)(&max_id=[A-Za-z0-9_\\-.~=%]{1,512})?$`), schema: homeSchema },
  // A circle's timeline (Bonfire: MastoListController.list_timeline over Circles), for circles pinned to Feeds.
  { match: new RegExp(`^/api/v1/timelines/list/${ID}\\?limit=20(&max_id=[A-Za-z0-9_\\-.~=%]{1,512})?$`), schema: homeSchema },
  // What the server takes in a post: its upload size limits and length (Bonfire: InstanceAdapter), for the composer.
  { match: /^\/api\/v2\/instance$/, schema: instanceSchema, single: true },
  // One post, as the person sees it (their like, boost and bookmark, its counts): for group posts read publicly.
  { match: new RegExp(`^/api/v1/statuses/${ID}$`), schema: timelineStatus, single: true },
  // A post's conversation: the posts above it and every reply under it, as the reader may see them (Mastodon
  // StatusContext; Bonfire: SocialMastoAdapter.status_context over its reply tree). One odd post is left out rather
  // than failing the whole conversation.
  { match: new RegExp(`^/api/v1/statuses/${ID}/context$`), schema: z.object({ ancestors: tolerantStatuses, descendants: tolerantStatuses }), single: true },
  // People asking to follow you (a locked account approves each): Bonfire MastoAccountController.follow_requests.
  { match: /^\/api\/v1\/follow_requests\?limit=40$/, schema: followRequestsSchema },
  // A post's own text and content warning, to edit it (Mastodon: StatusSourcesController; Bonfire: status_source).
  { match: new RegExp(`^/api/v1/statuses/${ID}/source$`), schema: z.object({ id: z.string().max(64).nullish(), text: z.string().max(20_000), spoiler_text: z.string().max(1000).nullish().catch(null) }), single: true },
  // A poll's current counts and the reader's votes (Bonfire: MastoPollController.show).
  { match: new RegExp(`^/api/v1/polls/${ID}$`), schema: pollSchema, single: true },
  // Posts matching a search (Mastodon v2 search, statuses only; Bonfire: MastoSearchController). The query arrives
  // percent-encoded.
  { match: /^\/api\/v2\/search\?q=[A-Za-z0-9_.~%*'()!-]{1,2400}&type=statuses&limit=20$/, schema: z.object({ statuses: z.array(timelineStatus).max(40) }), single: true },
  // Hashtags starting with what's typed after "#" in the composer (Mastodon v2 search, hashtags).
  { match: /^\/api\/v2\/search\?q=[A-Za-z0-9_%]{1,1200}&type=hashtags&limit=8$/, schema: z.object({ hashtags: z.array(z.object({ name: z.string().min(1).max(100) })).max(40) }), single: true },
  // People you mute (Bonfire: MastoAccountController.mutes).
  { match: /^\/api\/v1\/mutes\?limit=80$/, schema: moderationListSchema },
  { match: /^\/api\/v1\/mutes\?limit=80&max_id=[A-Za-z0-9_\-.~=%]{1,512}$/, schema: moderationListSchema },
  // Posts you liked, newest first (Bonfire: MastoTimelineController.favourites).
  { match: /^\/api\/v1\/favourites\?limit=40$/, schema: bookmarksSchema },
  // Who liked or boosted a post.
  { match: new RegExp(`^/api/v1/statuses/${ID}/(favourited_by|reblogged_by)\\?limit=40$`), schema: accountsSchema },
  // Someone's posts as Fedizen has them, newest first, then older pages by the Link header's cursor (Bonfire:
  // MastoTimelineController.user_statuses over the user_activities feed), so a profile's posts can be acted on.
  { match: new RegExp(`^/api/v1/accounts/${ID}/statuses\\?limit=20(&max_id=[A-Za-z0-9_\\-.~=%]{1,512})?$`), schema: homeSchema },
  // Your own recent posts, without boosts: the hashtags you used lately come first in the composer's suggestions.
  { match: new RegExp(`^/api/v1/accounts/${ID}/statuses\\?limit=40&exclude_reblogs=true$`), schema: homeSchema },
];

/** A status from Fedizen's live stream, checked like any timeline read (live.server.ts); null when it doesn't fit. */
export function liveStatus(raw: unknown): unknown | null {
  const r = timelineStatus.safeParse(raw);
  return r.success ? r.data : null;
}

const MAX_PRIVATE_READ_BYTES = 2 * 1024 * 1024;

/** A page cursor from a Link header (Bonfire's are opaque Paginator cursors, "g3…"; Mastodon's are ids). */
export const PAGE_CURSOR = /^[A-Za-z0-9_\-.~=%]{1,512}$/;

/**
 * The next (older) and previous (newer) page cursors from a Mastodon-style Link header, taken only from links on
 * Fedizen itself (max_id for rel="next", min_id for rel="prev"), and only when they look like cursors.
 */
export function pageCursors(link: string | null): { next?: string; prev?: string } {
  const out: { next?: string; prev?: string } = {};
  if (!link || link.length > 8192) return out;
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?(next|prev)"?/);
    if (!m) continue;
    let u: URL;
    try { u = new URL(m[1]); } catch { continue; }
    if (u.origin !== FEDIZEN) continue;
    const v = u.searchParams.get(m[2] === 'next' ? 'max_id' : 'min_id');
    if (v && PAGE_CURSOR.test(encodeURIComponent(v))) out[m[2] as 'next' | 'prev'] = v;
  }
  return out;
}

/** Why a private read gave nothing back: Fedizen refused it (its status), sent something unreadable, or sent JSON in a
 *  shape Atlas doesn't accept. Never carries the response itself. */
export type FedizenReadFailure = 'unreachable' | 'refused' | 'unreadable' | 'mismatch';

/**
 * A read's route for logs: the path without its query, with every segment that could name a person, post, tag or
 * search (ids, handles, hashtags) replaced by ":x". Only Mastodon's fixed route words survive.
 */
export function readRoute(path: string): string {
  const parts = path.split('?')[0].split('/');
  return parts.map((seg, i) => (i === 2 && /^v\d(-bonfire)?$/.test(seg)) || (/^[a-z][a-z0-9_-]{0,30}$/.test(seg) && !/^(tag|tags|lookup)$/.test(parts[i - 1] ?? '') && !/\d/.test(seg)) ? seg : seg ? ':x' : seg).join('/');
}

/** Where an answer's shape differed from Atlas's schema: field paths and zod issue codes, never values. */
export type FedizenReadIssue = { at: string; code: string };

export async function fedizenGet(token: string, path: string, opts: { requireCompleteModeration?: boolean } = {}): Promise<{ status: number; data: unknown[]; next?: string; prev?: string; failure?: FedizenReadFailure; issues?: FedizenReadIssue[] }> {
  const read = READS.find(r => r.match.test(path));
  if (!read) throw new Error('Unsupported Fedizen read path.');
  // Fedizen's rate limit (fedizen-rate-limit.ts): wait it out rather than ask again; a post read moments ago is reused.
  const account = await accountKey(token);
  if (waitLeft(account) > 0) return { status: 429, data: [], failure: 'refused' };
  const isStatus = STATUS_PATH.test(path);
  if (isStatus) {
    const hit = cachedStatus(account, path);
    if (hit !== undefined) return { status: 200, data: [hit] };
  }

  // The same read by this account moments ago, or one already on its way, is shared (fedizen-microcache.ts).
  return microcached(account, `${opts.requireCompleteModeration ? 'strict ' : ''}${path}`, reuseFor(path), () => sendRead(token, path, account, read, isStatus, opts));
}

/** Reads that take this long are logged (route and time only), to tell a slow Fedizen from a slow Atlas. */
const SLOW_READ_MS = 2_500;

async function sendRead(token: string, path: string, account: string, read: (typeof READS)[number], isStatus: boolean, opts: { requireCompleteModeration?: boolean }): Promise<{ status: number; data: unknown[]; next?: string; prev?: string; failure?: FedizenReadFailure; issues?: FedizenReadIssue[] }> {
  // Fedizen stopped answering moments ago (fedizen-breaker.ts): say so at once rather than wait out another 10 s.
  if (!mayAskFedizen()) return { status: 503, data: [], failure: 'unreachable' };

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${FEDIZEN}${path}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': FEDIZEN_USER_AGENT },
      signal: AbortSignal.timeout(10000),
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch (e) {
    const why = transportDetail(e);
    console.error('Fedizen read unreachable', { route: readRoute(path), why });
    if (why === 'timeout') {
      if (noteFedizenTimeout(readRoute(path))) console.warn('Fedizen not answering: reads paused', { seconds: BREAKER.pauseMs / 1000 });
    } else noteFedizenUnreached();
    return { status: 503, data: [], failure: 'unreachable' };
  }
  noteFedizenAnswered();
  const took = Date.now() - started;
  if (took >= SLOW_READ_MS) console.warn('Fedizen read slow', { route: readRoute(path), ms: took, status: response.status });

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 429) {
      const ms = noteRateLimited(account, response.headers.get('retry-after'));
      console.warn('Fedizen rate limited', { route: readRoute(path), waitSeconds: Math.round(ms / 1000) });
    } else console.warn('Fedizen read refused', { route: readRoute(path), status: response.status });
    return { status: response.status, data: [], failure: 'refused' };
  }

  let payload: unknown;
  try {
    payload = await readBoundedFedizenJson(response, MAX_PRIVATE_READ_BYTES);
  } catch {
    // Includes decode, timeout/stream, oversize and malformed JSON failures.
    // Do not log bearer values or private response bodies.
    console.warn('Fedizen read unreadable', { route: readRoute(path) });
    return { status: 502, data: [], failure: 'unreadable' };
  }
  // Strictly read ALL block/mute identities for personalized discovery. The
  // ordinary user-facing moderation list keeps its historical tolerant parser.
  // Do not broaden strict parsing to unrelated endpoints or let callers opt
  // into bypassing the existing fixed-path allowlist.
  const isModerationRoute = /^\/api\/v1\/(blocks|mutes)\?limit=80(?:&max_id=[A-Za-z0-9_\-.~=%]{1,512})?$/.test(path);
  const parsed = (opts.requireCompleteModeration && isModerationRoute
    ? completeModerationSchema : read.schema).safeParse(payload);
  if (!parsed.success) {
    // Where the shape differs (field names, array positions and the kind of mismatch), never the values.
    const issues = parsed.error.issues.slice(0, 5).map(i => ({ at: i.path.join('.'), code: i.code }));
    console.warn('Fedizen read did not match', { route: readRoute(path), issues });
    return { status: 502, data: [], failure: 'mismatch', issues };
  }
  if (isStatus) keepStatus(account, path, parsed.data);
  return { status: 200, data: read.single ? [parsed.data] : parsed.data as unknown[], ...pageCursors(response.headers.get('link')) };
}

/** One post (GET /api/v1/statuses/:id): the read kept briefly per account. */
const STATUS_PATH = new RegExp(`^/api/v1/statuses/${ID}$`);

/**
 * The writes Atlas makes as the person, and nothing else:
 * - join or leave a Bonfire group (/api/v1-bonfire/groups/:id/join|leave); follow or unfollow an account;
 * - bookmark, like or boost a post, and undo each; reply to a post; block or unblock a person (Moderation);
 * - create, rename and delete a circle, and add or remove its members (Mastodon Lists, served from Bonfire Circles).
 * Each route names its method and the only body it may carry. Same transport rules as reads: fixed host,
 * no redirects, no caching, bounded reply, nothing logged.
 */
const title = z.object({ title: z.string().trim().min(1).max(100) }).strict();
/**
 * A post: a reply (in the post's audience or a narrower one) or a new post, with its text, an optional content
 * warning, and up to 4 uploaded media ids marked sensitive or not. Text may be empty only when there is media.
 */
/** A poll in a new post (Mastodon: poll[options], poll[expires_in], poll[multiple]); Bonfire takes 2 to 100 options. */
const pollIn = z.object({
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(4),
  expires_in: z.number().int().min(300).max(2_629_746),
  multiple: z.boolean(),
}).strict();
const edit = z.object({ status: z.string().trim().max(5000), spoiler_text: z.string().trim().max(500) }).strict().refine(p => p.status.length > 0 || p.spoiler_text.length > 0, 'empty post');
const report = z.object({
  account_id: z.string().regex(new RegExp(`^${ID}$`)),
  status_ids: z.array(z.string().regex(new RegExp(`^${ID}$`))).max(20).optional(),
  comment: z.string().trim().max(1000),
  category: z.enum(['spam', 'legal', 'violation', 'other']),
  forward: z.boolean(),
}).strict();
const votes = z.object({ choices: z.array(z.number().int().min(0).max(99)).min(1).max(100) }).strict();
const reply = z.object({
  status: z.string().trim().max(5000),
  in_reply_to_id: z.string().regex(new RegExp(`^${ID}$`)).optional(),
  visibility: z.enum(['public', 'unlisted', 'private', 'direct']),
  /** A content warning (Mastodon: spoiler_text; Bonfire stores it as the post's summary). */
  spoiler_text: z.string().trim().min(1).max(500).optional(),
  media_ids: z.array(z.string().regex(new RegExp(`^${ID}$`))).min(1).max(4).optional(),
  sensitive: z.boolean().optional(),
  poll: pollIn.optional(),
}).strict().refine(p => p.status.length > 0 || !!p.media_ids?.length || !!p.poll, 'empty post').refine(p => !(p.poll && p.media_ids?.length), 'a poll has no media').refine(p => p.sensitive === undefined || !!p.media_ids?.length, 'sensitive without media');
const members = z.object({ account_ids: z.array(z.string().regex(new RegExp(`^${ID}$`))).min(1).max(20) }).strict();
/** Mastodon push alerts Atlas offers (Mastodon WebPushSubscription), and who may trigger them. */
const pushData = z.object({
  alerts: z.object({ mention: z.boolean(), status: z.boolean(), reblog: z.boolean(), follow: z.boolean(), follow_request: z.boolean(), favourite: z.boolean(), poll: z.boolean(), update: z.boolean(), quote: z.boolean() }).strict(),
  policy: z.enum(['all', 'followed', 'follower', 'none']),
}).strict();
const B64U = /^[A-Za-z0-9_-]+={0,2}$/;
/** A push subscription pointing at Atlas's relay, never anywhere else (live.server's sibling, push/relay.server.ts). */
const pushSubscribe = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(512).refine(u => /^https:\/\/[^/]+\/api\/push\/relay\/[A-Za-z0-9_-]{22,64}$/.test(u), 'relay'),
    keys: z.object({ p256dh: z.string().regex(B64U).min(80).max(100), auth: z.string().regex(B64U).min(20).max(30) }).strict(),
  }).strict(),
  data: pushData,
}).strict();

const WRITES: { method: 'POST' | 'PUT' | 'DELETE'; match: RegExp; body?: z.ZodTypeAny }[] = [
  // Push notifications through Atlas's relay (Bonfire: MastoPushController; one subscription per access token).
  { method: 'POST', match: /^\/api\/v1\/push\/subscription$/, body: pushSubscribe },
  { method: 'PUT', match: /^\/api\/v1\/push\/subscription$/, body: z.object({ data: pushData }).strict() },
  { method: 'DELETE', match: /^\/api\/v1\/push\/subscription$/ },
  { method: 'POST', match: new RegExp(`^/api/v1-bonfire/groups/${ID}/(join|leave)$`) },
  { method: 'POST', match: new RegExp(`^/api/v1/accounts/${ID}/(follow|unfollow)$`) },
  // Follow or unfollow a hashtag, as Mastodon does (Bonfire: MastoTagController, bonfire_tag; following creates the tag).
  { method: 'POST', match: new RegExp(`^/api/v1/tags/${TAG}/(follow|unfollow)$`) },
  { method: 'POST', match: new RegExp(`^/api/v1/statuses/${ID}/(bookmark|unbookmark|favourite|unfavourite|reblog|unreblog)$`) },
  { method: 'POST', match: /^\/api\/v1\/statuses$/, body: reply },
  { method: 'POST', match: new RegExp(`^/api/v1/accounts/${ID}/(block|unblock|mute|unmute)$`) },
  // Report an account or its posts to Fedizen's moderators (Mastodon POST /reports; Bonfire: flag).
  { method: 'POST', match: /^\/api\/v1\/reports$/, body: report },
  { method: 'POST', match: /^\/api\/v1\/lists$/, body: title },
  { method: 'PUT', match: new RegExp(`^/api/v1/lists/${ID}$`), body: title },
  { method: 'DELETE', match: new RegExp(`^/api/v1/lists/${ID}$`) },
  { method: 'POST', match: new RegExp(`^/api/v1/lists/${ID}/accounts$`), body: members },
  { method: 'DELETE', match: new RegExp(`^/api/v1/lists/${ID}/accounts$`), body: members },
  // Your own posts: delete, and edit their text and content warning (Bonfire: delete_status, update_status).
  { method: 'DELETE', match: new RegExp(`^/api/v1/statuses/${ID}$`) },
  { method: 'PUT', match: new RegExp(`^/api/v1/statuses/${ID}$`), body: edit },
  // Mark notifications read up to one (Mastodon markers), so Fedizen's own unread count and other apps agree.
  { method: 'POST', match: /^\/api\/v1\/markers$/, body: z.object({ notifications: z.object({ last_read_id: z.string().regex(new RegExp(`^${ID}$`)) }).strict() }).strict() },
  // Answer someone asking to follow you.
  { method: 'POST', match: new RegExp(`^/api/v1/follow_requests/${ID}/(authorize|reject)$`) },
  // Vote in a poll, by option index (Bonfire: MastoPollController.vote).
  { method: 'POST', match: new RegExp(`^/api/v1/polls/${ID}/votes$`), body: votes },
];
const writeReply = z.object({
  id: z.string().max(64).nullish(),
  // A push subscription's VAPID public key (Mastodon WebPushSubscription.server_key): Atlas's relay checks pushes with it.
  server_key: z.string().regex(/^[A-Za-z0-9_\-=+/]{40,200}$/).nullish().catch(null),
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
  /** Markers answer with the marker saved. */
  notifications: z.object({ last_read_id: z.string().max(64).nullish().catch(null) }).nullish().catch(null),
  /** Voting answers with the poll itself. */
  options: pollSchema.shape.options.nullish().catch(null),
  votes_count: z.number().int().min(0).nullish().catch(null),
  voters_count: z.number().int().min(0).nullish().catch(null),
  voted: z.boolean().nullish().catch(null),
  own_votes: z.array(z.number().int().min(0).max(100)).max(100).nullish().catch(null),
  expired: z.boolean().nullish().catch(null),
  expires_at: z.string().max(40).nullish().catch(null),
  multiple: z.boolean().nullish().catch(null),
});

export async function fedizenSend(token: string, method: 'POST' | 'PUT' | 'DELETE', path: string, body?: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> | null }> {
  const route = WRITES.find(w => w.method === method && w.match.test(path));
  if (!route) throw new Error('Unsupported Fedizen write path.');
  if (!route.body !== !body) throw new Error('Unsupported Fedizen write body.');
  const payload = route.body ? route.body.safeParse(body) : null;
  if (payload && !payload.success) throw new Error('Unsupported Fedizen write body.');
  const account = await accountKey(token);
  if (waitLeft(account) > 0) return { status: 429, data: null };
  // Whatever this account changes, its earlier reads may no longer be true (its own like, boost or reply).
  forgetAccountReads(account);
  let response: Response;
  try {
    response = await fetch(`${FEDIZEN}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': FEDIZEN_USER_AGENT, ...(payload ? { 'content-type': 'application/json' } : {}) },
      body: payload ? JSON.stringify(payload.data) : undefined,
      signal: AbortSignal.timeout(10000),
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch (e) {
    console.error('Fedizen write unreachable', { why: transportDetail(e) });
    return { status: 503, data: null };
  }
  forgetAccountReads(account); // and again once the write is done, in case a read landed in between
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 429) noteRateLimited(account, response.headers.get('retry-after'));
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


const uploadedSchema = z.object({
  id: z.string().regex(new RegExp(`^${ID}$`)),
  type: z.string().max(20).nullish(),
  preview_url: z.string().max(2048).nullish(),
});
export const MEDIA_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/webm'];

/**
 * Uploads one file to Fedizen (POST /api/v2/media, multipart, as Mastodon's API takes it), with its alt text. Only the
 * types Fedizen stores as images or video, at most `maxBytes`. Answers the media id to attach to a post.
 */
export async function fedizenUpload(token: string, file: Blob, name: string, description: string, maxBytes: number): Promise<{ status: number; id?: string; preview?: string }> {
  if (!MEDIA_UPLOAD_TYPES.includes(file.type)) throw new Error('Unsupported Fedizen upload type.');
  if (file.size <= 0 || file.size > maxBytes) throw new Error('Unsupported Fedizen upload size.');
  if (description.length > 1500) throw new Error('Unsupported Fedizen upload description.');
  const form = new FormData();
  form.set('file', file, name.replace(/[^\w.-]+/g, '_').slice(0, 100) || 'upload');
  if (description.trim()) form.set('description', description.trim());
  const account = await accountKey(token);
  if (waitLeft(account) > 0) return { status: 429 };
  let response: Response;
  try {
    response = await fetch(`${FEDIZEN}/api/v2/media`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': FEDIZEN_USER_AGENT },
      body: form,
      // Bonfire stores and resizes (or transcodes) the file before it answers.
      signal: AbortSignal.timeout(file.type.startsWith('video/') ? 120_000 : 45_000),
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return { status: 503 };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 429) noteRateLimited(account, response.headers.get('retry-after'));
    return { status: response.status };
  }
  try {
    const m = uploadedSchema.safeParse(await readBoundedFedizenJson(response, 65536));
    if (!m.success) return { status: 502 };
    const preview = m.data.preview_url && /^https:\/\//.test(m.data.preview_url) ? m.data.preview_url : undefined;
    return { status: response.status, id: m.data.id, ...(preview ? { preview } : {}) };
  } catch {
    return { status: 502 };
  }
}
