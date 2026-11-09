import { FEDIZEN, FEDIZEN_API_SCOPE } from './fedizen-feed';

const b64url = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const admin = async () => (await import('@/integrations/supabase/client.server')).supabaseAdmin;

async function appFor(redirectUri: string) {
  const db = await admin();
  const { data } = await db.from('fedizen_oauth_apps').select('client_id, client_secret').eq('redirect_uri', redirectUri).maybeSingle();
  if (data) return data;
  const res = await fetch(`${FEDIZEN}/api/v1/apps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Atlas', redirect_uris: redirectUri, scopes: FEDIZEN_API_SCOPE, website: new URL(redirectUri).origin }), signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Fedizen app registration failed [${res.status}]`);
  const j = await res.json() as { client_id: string; client_secret: string };
  await db.from('fedizen_oauth_apps').insert({ redirect_uri: redirectUri, client_id: j.client_id, client_secret: j.client_secret });
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

export async function finishConnect(userId: string, code: string, state: string) {
  const db = await admin();
  const st = await consumeOAuthState(db, userId, state);
  const age = st ? Date.now() - new Date(st.created_at).getTime() : NaN;
  if (!st || !Number.isFinite(age) || age < 0 || age > 15 * 60_000) return { ok: false as const, error: 'This connection link expired. Please try again.' };
  const app = await appFor(st.redirect_uri);
  const res = await fetch(`${FEDIZEN}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: st.redirect_uri, client_id: app.client_id, client_secret: app.client_secret, code_verifier: st.code_verifier }), signal: AbortSignal.timeout(10000) });
  if (!res.ok) { console.error(`Fedizen token exchange failed [${res.status}]`); return { ok: false as const, error: 'Fedizen didn’t accept the connection. Please try again.' }; }
  const tok = await res.json() as { access_token: string; scope?: string };
  let handle: string | null = null;
  const me = await fetch(`${FEDIZEN}/api/v1/accounts/verify_credentials`, { headers: { authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(10000) });
  if (me.ok) handle = ((await me.json()) as { acct?: string }).acct ?? null;
  const { error: saveError } = await db.from('fedizen_connections').upsert({ user_id: userId, access_token: tok.access_token, scope: tok.scope ?? FEDIZEN_API_SCOPE, account_handle: handle });
  if (saveError) throw new Error('Could not save Fedizen connection.');
  return { ok: true as const };
}

export async function tokenFor(userId: string) {
  const db = await admin();
  const { data } = await db.from('fedizen_connections').select('access_token, account_handle').eq('user_id', userId).maybeSingle();
  return data;
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
