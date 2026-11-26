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

type RawStatus = { id?: unknown; uri?: unknown; url?: unknown; in_reply_to_id?: unknown; visibility?: unknown };

/** The origin's context `descendants` as OriginReply: public or unlisted only, ids checked, at most MAX_ORIGIN_REPLIES. */
export function originReplies(raw: unknown): OriginReply[] {
  const list = (Array.isArray(raw) ? raw : []).filter((s): s is RawStatus => !!s && typeof s === 'object'
    && typeof (s as RawStatus).id === 'string' && /^\d{1,25}$/.test((s as RawStatus).id as string)
    && ((s as RawStatus).visibility === 'public' || (s as RawStatus).visibility === 'unlisted')).slice(0, MAX_ORIGIN_REPLIES);
  const posts = fromStatuses(list as never);
  return list.flatMap((s, i) => {
    const post = posts[i];
    if (!post) return [];
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
    const { statusId: _s, counts: _c, liked: _l, boosted: _b, bookmarked: _k, ...rest } = r.post;
    return { ...rest, id: keyOf.get(r.id)!, replyTo: { statusId: parent }, notOnFedizen: { host: origin.host } };
  });
}
