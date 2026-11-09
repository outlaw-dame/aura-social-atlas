import { FEDIZEN, FEDIZEN_API_SCOPE } from './fedizen-feed';

const b64url = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const admin = async () => (await import('@/integrations/supabase/client.server')).supabaseAdmin;

async function appFor(redirectUri: string) {
  const db = await admin();
  const { data, error: lookupError } = await db.from('fedizen_oauth_apps').select('client_id, client_secret').eq('redirect_uri', redirectUri).maybeSingle();
  if (lookupError) throw new Error('Could not read Fedizen OAuth app registration.');
  if (data) return data;
  const res = await fetch(`${FEDIZEN}/api/v1/apps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Atlas', redirect_uris: redirectUri, scopes: FEDIZEN_API_SCOPE, website: new URL(redirectUri).origin }), signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Fedizen app registration failed [${res.status}]`);
  const j = await res.json() as { client_id: string; client_secret: string };
  const { error: registrationError } = await db.from('fedizen_oauth_apps').insert({ redirect_uri: redirectUri, client_id: j.client_id, client_secret: j.client_secret });
  if (registrationError) throw new Error('Could not persist Fedizen OAuth app registration.');
  return j;
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
  if (typeof token !== 'string' || !token.trim() || token.length > 8192 || /[\\r\\n]/.test(token)) return null;
  if (scope !== undefined && (typeof scope !== 'string' ||
    !scope.split(/\\s+/).includes(FEDIZEN_API_SCOPE))) return null;
  return { access_token: token, scope: typeof scope === 'string' ? scope : FEDIZEN_API_SCOPE };
}

export function parseFedizenAccount(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const account = payload as Record<string, unknown>;
  // Account identity MUST be present before a grant can be associated with a
  // local Atlas account. Do not persist an unverified anonymous bearer.
  return typeof account.id === 'string' && account.id.length > 0 &&
    typeof account.acct === 'string' && account.acct.length > 0 &&
    account.acct.length <= 320 && !/[\\s\\r\\n]/.test(account.acct)
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
    const size = response.headers.get('content-length');
    if (size !== null && Number(size) > 16384) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    // This account response is normally small. The bounded streaming transport
    // used for public GraphQL will be generalized later for all auth reads.
    const data: unknown = await response.json();
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

export async function fedizenGet(token: string, path: string): Promise<{ status: number; data: unknown[] }> {
  // Only fixed, same-origin Mastodon-compatible read paths are accepted.
  if (path !== '/api/v1/timelines/home?limit=20' && path !== '/api/v1/notifications?limit=20') {
    throw new Error('Unsupported Fedizen read path.');
  }
  try {
    const res = await fetch(`${FEDIZEN}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!res.ok) return { status: res.status, data: [] };
    const payload: unknown = await res.json();
    // Returning 200/[] for a malformed payload silently masks upstream drift.
    return Array.isArray(payload) ? { status: 200, data: payload } : { status: 502, data: [] };
  } catch {
    // Never log the bearer token or remote response body.
    return { status: 503, data: [] };
  }
}
