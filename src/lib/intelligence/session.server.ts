import { createClient } from '@supabase/supabase-js';

/**
 * The signed-in Atlas user behind a plain API route (server functions get this from requireSupabaseAuth): the Supabase
 * access token in the Authorization header, verified by Supabase. Null when missing or invalid.
 */
export async function userIdFromRequest(request: Request): Promise<string | null> {
  const url = process.env['SUPABASE_URL'], key = process.env['SUPABASE_PUBLISHABLE_KEY'];
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!url || !key || token.split('.').length !== 3) return null;
  // As in auth-middleware.ts: Supabase's newer opaque keys go in `apikey`, never as a bearer token.
  const opaque = key.startsWith('sb_publishable_') || key.startsWith('sb_secret_');
  const fetchWithKey: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (opaque && headers.get('Authorization') === `Bearer ${key}`) headers.delete('Authorization');
    headers.set('apikey', key);
    return fetch(input, { ...init, headers });
  };
  const supabase = createClient(url, key, { global: { fetch: fetchWithKey }, auth: { storage: undefined, persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getClaims(token);
  return !error && typeof data?.claims?.sub === 'string' ? data.claims.sub : null;
}
