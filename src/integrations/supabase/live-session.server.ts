/**
 * Confirms that a verified Supabase access token still belongs to a live session.
 *
 * `auth.getClaims` checks the token's signature locally (ES256 signing keys), so it keeps accepting a token after the
 * user signs out until the token expires, up to an hour. Supabase Auth's `/user` endpoint looks the session up and
 * refuses a signed-out one (403). Private Atlas routes hand out Fedizen data, so they ask Auth once more here.
 *
 * Simultaneous checks of one session share a single request, and a confirmed session is remembered for a few seconds,
 * so a page that fires a dozen server functions costs one round trip, not twelve. A signed-out session can therefore
 * still be served for at most CONFIRMED_FOR_MS. Any error from Auth, including a network failure, refuses the request.
 */
type AuthLike = {
  auth: {
    getUser(jwt: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
};

type Claims = { sub?: unknown; session_id?: unknown; exp?: unknown };

export const CONFIRMED_FOR_MS = 15_000;
const MAX_REMEMBERED = 1_000;
const confirmed = new Map<string, number>();
const inFlight = new Map<string, Promise<boolean>>();

export function forgetConfirmedSessions(): void {
  confirmed.clear();
  inFlight.clear();
}

async function askAuth(supabase: AuthLike, token: string, sub: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getUser(token);
    return !error && data?.user?.id === sub;
  } catch {
    return false;
  }
}

export async function confirmLiveSession(
  supabase: AuthLike,
  token: string,
  claims: Claims,
  now: number = Date.now(),
): Promise<boolean> {
  const sub = typeof claims.sub === "string" ? claims.sub : null;
  if (!sub) return false;
  const sessionId =
    typeof claims.session_id === "string" && claims.session_id ? claims.session_id : null;
  const key = sessionId ? `${sub}:${sessionId}` : null;

  if (key) {
    const until = confirmed.get(key);
    if (until !== undefined) {
      if (until > now) return true;
      confirmed.delete(key);
    }
  }

  if (!key) return askAuth(supabase, token, sub);

  // Requests fired together share one question to Auth instead of all missing the cache at once.
  let pending = inFlight.get(key);
  if (!pending) {
    pending = askAuth(supabase, token, sub).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  if (!(await pending)) return false;

  if (confirmed.size >= MAX_REMEMBERED) {
    const oldest = confirmed.keys().next().value;
    if (oldest !== undefined) confirmed.delete(oldest);
  }
  const expiresAt = typeof claims.exp === "number" ? claims.exp * 1000 : now;
  confirmed.set(key, Math.min(now + CONFIRMED_FOR_MS, expiresAt));
  return true;
}
