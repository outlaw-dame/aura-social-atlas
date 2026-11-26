/**
 * Replies to a post that Fedizen hasn't received, read from the post's own server.
 *
 * Fedizen (Bonfire) shows the replies it has; it doesn't go and fetch the rest of a remote post's conversation, so a
 * post that reached it through a hashtag relay, or from someone few people on Fedizen follow, often opens with few or
 * none of its replies. Mastodon (and servers that copy its API) answer GET /api/v1/statuses/:id/context publicly for a
 * public post; Atlas reads that from the post's own server and shows the replies Fedizen doesn't have in their place,
 * read-only and marked "Not on Fedizen yet" (they have no Fedizen status to like or reply to), as profiles already do
 * with an account's newest posts (profile-posts.ts).
 */
import { fromStatuses, type FedizenPost } from './fedizen-feed';
import { domainBlocked, normalizedAccount, type SpotlightModeration } from './spotlight-curation';

export const MAX_ORIGIN_REPLIES = 80;

/** The post's own server and its id there, from its address: Mastodon's /@user/:id or /users/:user/statuses/:id. */
export function originOf(url: string | undefined | null): { host: string; id: string } | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || u.search || u.hash) return null;
  const m = /^\/(?:@[A-Za-z0-9_.-]{1,64}|users\/[A-Za-z0-9_.-]{1,64}\/statuses)\/(\d{1,25})\/?$/.exec(u.pathname);
  return m ? { host: u.hostname.toLowerCase(), id: m[1]! } : null;
}

/** An origin reply's key in the thread: never a Fedizen status id, so it can't be acted on as one. */
export const originKey = (host: string, id: string) => `origin:${host}:${id}`;

/** A reply as the origin server has it: its id there, what it answers there, and the post as Atlas shows it. */
export type OriginReply = { id: string; inReplyTo?: string; uri?: string; url?: string; post: FedizenPost };

/** A reply's author as a full handle (`alice@mastodon.example`), for checking against the reader's moderation. */
export const authorOf = (r: OriginReply) => normalizedAccount(r.post.acct ?? r.post.handle ?? '');

/** At most this many reply authors are checked with Fedizen per conversation; replies by anyone further are left out. */
export const MAX_CHECKED_AUTHORS = 40;

/** What Fedizen says about one reply author: known (with the reader's relationship), unknown to it, or unreadable. */
export type AuthorCheck =
  | { state: 'known'; blocking?: boolean | null; muting?: boolean | null; domain_blocking?: boolean | null }
  | { state: 'unknown' }
  | { state: 'unreadable' };

/**
 * The origin replies the reader would see on Fedizen: none by anyone they block or mute, none from a server they block.
 * These come from another server, so Fedizen's own filtering never saw them; Atlas applies the reader's moderation
 * itself and leaves a reply out whenever it can't tell:
 * - people they block or mute: the complete lists (`moderation`, read to the end or not at all);
 * - each author Fedizen knows: its relationship (blocking, muting, domain_blocking);
 * - servers they block: the full list when Fedizen gives it (`domainCoverage: 'complete'`); otherwise a server counts
 *   as blocked when any author from it is domain-blocked, so an author Fedizen hasn't seen yet is shown only from a
 *   server none of the checked authors' relationships says is blocked;
 * - an author whose check failed, or past MAX_CHECKED_AUTHORS, is left out.
 */
export function visibleOriginReplies(
  replies: OriginReply[],
  moderation: SpotlightModeration,
  checks: ReadonlyMap<string, AuthorCheck>,
): OriginReply[] {
  const hidden = new Set([...moderation.blockedHandles, ...moderation.mutedHandles].map(h => normalizedAccount(h)).filter((h): h is string => !!h));
  const blockedHosts = new Set<string>();
  for (const [acct, c] of checks) if (c.state === 'known' && c.domain_blocking) blockedHosts.add(acct.slice(acct.lastIndexOf('@') + 1));
  return replies.filter(r => {
    const acct = authorOf(r);
    if (!acct || hidden.has(acct)) return false;
    const host = acct.slice(acct.lastIndexOf('@') + 1);
    if (blockedHosts.has(host) || domainBlocked(host, moderation.blockedDomains)) return false;
    const c = checks.get(acct);
    if (!c || c.state === 'unreadable') return false;
    if (c.state === 'known') return !c.blocking && !c.muting && !c.domain_blocking;
    return true;
  });
}

/** Each reply's author as Fedizen knows them (`ids`: full handle → Fedizen account id); none when it doesn't. */
export function withFedizenIds(replies: OriginReply[], ids: ReadonlyMap<string, string>): OriginReply[] {
  return replies.map(r => {
    const { authorId: _a, ...post } = r.post;
    const acct = authorOf(r);
    const id = acct ? ids.get(acct) : undefined;
    return { ...r, post: id ? { ...post, authorId: id } : post };
  });
}

/** The distinct authors to check, in reply order, at most MAX_CHECKED_AUTHORS. */
export function authorsToCheck(replies: OriginReply[]): string[] {
  return [...new Set(replies.map(authorOf).filter((a): a is string => !!a))].slice(0, MAX_CHECKED_AUTHORS);
}

type RawStatus = { id?: unknown; uri?: unknown; url?: unknown; in_reply_to_id?: unknown; visibility?: unknown };

/** The origin's context `descendants` as OriginReply: public or unlisted only, ids checked, at most MAX_ORIGIN_REPLIES. */
export function originReplies(raw: unknown, host: string): OriginReply[] {
  const list = (Array.isArray(raw) ? raw : []).filter((s): s is RawStatus => !!s && typeof s === 'object'
    && typeof (s as RawStatus).id === 'string' && /^\d{1,25}$/.test((s as RawStatus).id as string)
    && ((s as RawStatus).visibility === 'public' || (s as RawStatus).visibility === 'unlisted')).slice(0, MAX_ORIGIN_REPLIES);
  // That server's own accounts come with a bare `acct` (`alice`), which Atlas would otherwise read as Fedizen's:
  // qualify them with the server they're on, authors and mentions alike.
  const qualify = (a: unknown) => (typeof a === 'string' && a && !a.includes('@') ? `${a}@${host}` : a);
  const qualified = list.map(s => {
    const o = s as RawStatus & { account?: { acct?: unknown }; mentions?: { acct?: unknown }[] };
    return {
      ...o,
      ...(o.account && typeof o.account === 'object' ? { account: { ...o.account, acct: qualify(o.account.acct) } } : {}),
      ...(Array.isArray(o.mentions) ? { mentions: o.mentions.map(m => (m && typeof m === 'object' ? { ...m, acct: qualify(m.acct) } : m)) } : {}),
    };
  });
  const posts = fromStatuses(qualified as never);
  return list.flatMap((s, i) => {
    const read = posts[i];
    if (!read) return [];
    // The author's id is the other server's, meaningless on Fedizen (who the reader follows, filters' exceptions):
    // left out here, and replaced with their Fedizen id where Fedizen knows them (withFedizenIds).
    const { authorId: _foreign, ...post } = read;
    const str = (v: unknown) => (typeof v === 'string' && v.length <= 2048 ? v : undefined);
    const inReplyTo = typeof s.in_reply_to_id === 'string' && /^\d{1,25}$/.test(s.in_reply_to_id) ? s.in_reply_to_id : undefined;
    return [{ id: s.id as string, ...(inReplyTo ? { inReplyTo } : {}), ...(str(s.uri) ? { uri: str(s.uri) } : {}), ...(str(s.url) ? { url: str(s.url) } : {}), post }];
  });
}

/**
 * The origin server's replies Fedizen doesn't have, as thread posts, each linked to its parent (the opened post, a
 * reply Fedizen has, or another origin reply). Fedizen's copy wins wherever both exist.
 */
export function repliesFedizenLacks(
  origin: { host: string; id: string },
  focus: Pick<FedizenPost, 'statusId' | 'id'>,
  fedizen: Pick<FedizenPost, 'statusId' | 'id' | 'uri' | 'url'>[],
  replies: OriginReply[],
): FedizenPost[] {
  const focusKey = focus.statusId ?? focus.id;
  // Fedizen's posts by their ActivityPub id and address, to find the ones it already has.
  const onFedizen = new Map<string, string>();
  for (const p of fedizen) for (const k of [p.uri, p.url]) if (k) onFedizen.set(k, p.statusId ?? p.id);
  // Each origin reply's key in this thread: Fedizen's own when it has it.
  const keyOf = new Map<string, string>([[origin.id, focusKey]]);
  for (const r of replies) keyOf.set(r.id, (r.uri && onFedizen.get(r.uri)) || (r.url && onFedizen.get(r.url)) || originKey(origin.host, r.id));
  return replies.filter(r => keyOf.get(r.id)!.startsWith('origin:')).map(r => {
    const parent = (r.inReplyTo && keyOf.get(r.inReplyTo)) || focusKey;
    // No Fedizen status: nothing to like, boost, save or reply to from Atlas.
    // No poll either: its id is the other server's, so a vote can't go through Fedizen.
    const { statusId: _s, counts: _c, liked: _l, boosted: _b, bookmarked: _k, pollState: _p, ...rest } = r.post;
    return { ...rest, id: keyOf.get(r.id)!, replyTo: { statusId: parent }, notOnFedizen: { host: origin.host } };
  });
}
