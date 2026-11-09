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
  const { data, error: lookupError } = await db.from('fedizen_oauth_apps').select('client_id, client_secret').eq('redirect_uri', redirectUri).maybeSingle();
  if (lookupError) throw new Error('Could not read Fedizen OAuth app registration.');
  if (data) {
    const stored = parseFedizenOAuthApp(data);
    if (!stored) throw new Error('Stored Fedizen OAuth app credentials are invalid.');
    return stored;
  }
  const registered = await registerFedizenOAuthApp(redirectUri);
  const { error: registrationError } = await db.from('fedizen_oauth_apps').insert({
    redirect_uri: redirectUri, ...registered,
  });
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
  if (scope !== undefined && (typeof scope !== 'string' ||
    !scope.split(/\s+/).includes(FEDIZEN_API_SCOPE))) return null;
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

export async function finishConnect(userId: string, code: string, state: string) {
  const db = await admin();
  const st = await consumeOAuthState(db, userId, state);
  const age = st ? Date.now() - new Date(st.created_at).getTime() : NaN;
  if (!st || !Number.isFinite(age) || age < 0 || age > 15 * 60_000) return { ok: false as const, error: 'This connection link expired. Please try again.' };
  const app = await appFor(st.redirect_uri);
  const res = await fetch(`${FEDIZEN}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: st.redirect_uri, client_id: app.client_id, client_secret: app.client_secret, code_verifier: st.code_verifier }), signal: AbortSignal.timeout(10000) });
  if (!res.ok) { console.error(`Fedizen token exchange failed [${res.status}]`); return { ok: false as const, error: 'Fedizen didn’t accept the connection. Please try again.' }; }
  let payload: unknown;
  try { payload = await res.json(); }
  catch { return { ok: false as const, error: 'Fedizen returned an invalid authorization response. Connect again.' }; }
  const grant = parseFedizenReadGrant(payload);
  if (!grant) return { ok: false as const, error: 'Fedizen did not grant the expected read access. Connect again.' };
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
    .select('access_token, account_handle').eq('user_id', userId).maybeSingle();
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

/** Server-side schema projection for the two existing read-only endpoints.
 * Reject malformed nested objects instead of crashing the personal timeline,
 * and strip unknown fields before they reach UI normalizers. */
const account = z.object({
  display_name: z.string().nullish(),
  username: z.string().nullish(),
  acct: z.string().nullish(),
  avatar: z.string().nullish(),
});
const media = z.object({
  type: z.string().nullish(),
  url: z.string().nullish(),
  preview_url: z.string().nullish(),
});
const status = z.object({
  id: z.string().min(1),
  url: z.string().nullish(),
  uri: z.string().nullish(),
  created_at: z.string().nullish(),
  content: z.string().nullish(),
  account: account.nullish(),
  media_attachments: z.array(media).nullish(),
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

const MAX_PRIVATE_READ_BYTES = 2 * 1024 * 1024;

export async function fedizenGet(token: string, path: string): Promise<{ status: number; data: unknown[] }> {
  // The only permitted private REST fallbacks until the equivalent GraphQL
  // operations are verified against Fedizen's installed Community schema.
  const home = path === '/api/v1/timelines/home?limit=20';
  const notifications = path === '/api/v1/notifications?limit=20';
  if (!home && !notifications) throw new Error('Unsupported Fedizen read path.');

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
  const parsed = (home ? homeSchema : notificationsSchema).safeParse(payload);
  return parsed.success ? { status: 200, data: parsed.data } : { status: 502, data: [] };
}
