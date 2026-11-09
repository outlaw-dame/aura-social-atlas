/** Browser-safe Fedizen (Mastodon-compatible) feed types, normalizers and redirect allowlist. */
import { htmlToParagraphs } from './spotlight';

export const FEDIZEN = 'https://fedizen.net';
/** Read-only: Atlas never posts, follows or changes anything on Fedizen with this permission. */
export const FEDIZEN_API_SCOPE = 'read';

export type FedizenPost = { id: string; author: string; handle: string; avatar?: string; paragraphs: string[]; url: string; date?: string; image?: string; boostedBy?: string };
export type FedizenNotice = { id: string; type: string; author: string; avatar?: string; date?: string; text: string };

type Acct = { display_name?: string; acct?: string; username?: string; avatar?: string };
type Status = { id: string; url?: string | null; uri?: string; created_at?: string; content?: string; account?: Acct; reblog?: Status | null; media_attachments?: { type?: string; url?: string; preview_url?: string }[] };
type Notice = { id: string; type?: string; created_at?: string; account?: Acct; status?: Status | null };

const http = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u : undefined);
const name = (a?: Acct) => a?.display_name || a?.username || a?.acct || 'Someone';

export function fromStatuses(list: Status[]): FedizenPost[] {
  return list.map(s => {
    const o = s.reblog ?? s;
    return {
      id: s.id, author: name(o.account), handle: `@${o.account?.acct ?? ''}`, avatar: http(o.account?.avatar),
      paragraphs: htmlToParagraphs(o.content ?? ''), url: http(o.url) ?? http(o.uri) ?? FEDIZEN, date: o.created_at,
      image: http(o.media_attachments?.find(m => m.type === 'image')?.preview_url ?? o.media_attachments?.find(m => m.type === 'image')?.url),
      boostedBy: s.reblog ? name(s.account) : undefined,
    };
  });
}

const verbs: Record<string, string> = { favourite: 'liked your post', reblog: 'boosted your post', follow: 'followed you', mention: 'mentioned you', status: 'posted', poll: 'poll ended', follow_request: 'asked to follow you' };
export function fromNotifications(list: Notice[]): FedizenNotice[] {
  return list.map(n => ({
    id: n.id, type: n.type ?? 'other', author: name(n.account), avatar: http(n.account?.avatar), date: n.created_at,
    text: `${verbs[n.type ?? ''] ?? 'interacted with you'}${n.status?.content ? ` — ${htmlToParagraphs(n.status.content).join(' ').slice(0, 140)}` : ''}`,
  }));
}

/**
 * A caller-supplied hostname is NOT a valid OAuth redirect trust boundary.
 * The HTTP Origin header must match the requested callback origin exactly.
 *
 * ATLAS_FEDIZEN_CALLBACK_ORIGINS is an optional comma-separated list of
 * canonical deployment origins. If configured it is an exact allowlist;
 * otherwise only the origin that served this request on an existing Atlas
 * Lovable host (or localhost for development) can initiate the connection.
 *
 * Custom domains MUST be explicitly configured in the exact allowlist.
 */
function parseCanonicalOrigin(value: string): URL | null {
  if (value.length > 256) return null;
  try {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password || url.pathname !== '/' ||
      url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

export function allowedCallback(
  requestedOrigin: string,
  requestOrigin: string | null,
  configuredOrigins = '',
): string | null {
  const requested = parseCanonicalOrigin(requestedOrigin);
  const caller = requestOrigin ? parseCanonicalOrigin(requestOrigin) : null;
  if (!requested || !caller || requested.origin !== caller.origin) return null;

  const configured = configuredOrigins.split(',').map(origin => origin.trim()).filter(Boolean);
  let allowed: boolean;
  if (configured.length) {
    allowed = configured.some(origin => {
      const parsed = parseCanonicalOrigin(origin);
      return parsed !== null && parsed.protocol === 'https:' && parsed.origin === requested.origin;
    });
  } else {
    const host = requested.hostname;
    allowed = (requested.protocol === 'https:' &&
      (host.endsWith('.lovable.app') || host.endsWith('.lovableproject.com'))) ||
      (requested.protocol === 'http:' && host === 'localhost');
  }
  return allowed ? `${requested.origin}/fedizen/callback` : null;
}

/**
 * Both Home and notifications are distinct authorized reads. A successful
 * timeline must never mask a failed notifications request (or vice versa).
 * 401 indicates the API grant must be reconnected; other failures are transient
 * or permission-specific and must not silently appear as empty results.
 */
export function fedizenReadError(homeStatus: number, notificationStatus: number): 'expired' | 'unavailable' | undefined {
  if (homeStatus === 401 || notificationStatus === 401) return 'expired';
  if (homeStatus !== 200 || notificationStatus !== 200) return 'unavailable';
  return undefined;
}

/**
 * Bind a browser-initiated Fedizen action to the Atlas session that displayed
 * it. The server's independently verified Supabase user ID is authoritative;
 * the expected ID only prevents session-switch races, never grants access.
 */
export function assertFedizenSessionIntent(expectedUserId: string, authenticatedUserId: string): void {
  if (!expectedUserId || expectedUserId !== authenticatedUserId) {
    throw new Error('Atlas session changed. Sign in again before continuing with Fedizen.');
  }
}
