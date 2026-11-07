/** Browser-safe Fedizen (Mastodon-compatible) feed types, normalizers and redirect allowlist. */
import { htmlToParagraphs } from './spotlight';

export const FEDIZEN = 'https://fedizen.net';
/** What Atlas asks Fedizen for: read your timeline and notifications, and act for you — join and leave
 *  groups, follow, post. Mastodon scope names, which Bonfire's OAuth provider (bonfire_open_id) supports. */
export const FEDIZEN_API_SCOPE = 'read write follow';

/** Where to return after connecting Fedizen: a same-site path only (never `//host` or a URL), else Feeds. */
export const RETURN_KEY = 'atlas-fedizen-return';
export function safeReturnPath(p: string | null | undefined): string {
  return p && /^\/(?![\/\\])[\w\-./?=&%]*$/.test(p) && !p.startsWith('/fedizen/') ? p : '/feeds';
}

/** Does a granted scope string cover `needed`? A parent scope covers its children ("write" covers "write:follows"). */
export function hasScope(granted: string | null | undefined, needed: string): boolean {
  const have = new Set(String(granted ?? '').split(/\s+/).filter(Boolean));
  return have.has(needed) || (needed.includes(':') && have.has(needed.split(':')[0]));
}

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

const verbs: Record<string, string> = { favourite: 'liked your post', reblog: 'boosted your post', follow: 'followed you', mention: 'mentioned you', status: 'posted', poll: 'poll ended', follow_request: 'asked to follow you', added_to_collection: 'added you to a collection', collection_update: 'updated a collection you’re in' };
export function fromNotifications(list: Notice[]): FedizenNotice[] {
  return list.map(n => ({
    id: n.id, type: n.type ?? 'other', author: name(n.account), avatar: http(n.account?.avatar), date: n.created_at,
    text: `${verbs[n.type ?? ''] ?? 'interacted with you'}${n.status?.content ? ` — ${htmlToParagraphs(n.status.content).join(' ').slice(0, 140)}` : ''}`,
  }));
}

/** Only Atlas's own hosts may receive the Fedizen authorization code. */
export function allowedCallback(origin: string): string | null {
  let u: URL; try { u = new URL(origin); } catch { return null; }
  const host = u.hostname;
  const ok = (u.protocol === 'https:' && (/\.lovable\.app$/.test(host) || /\.lovableproject\.com$/.test(host))) || (u.protocol === 'http:' && host === 'localhost');
  return ok ? `${u.origin}/fedizen/callback` : null;
}
