import { htmlToParagraphs } from './spotlight';
import { emojiMap, htmlToRich, type EmojiMap, type RichBlock } from './rich-text';
import { isPublicHttpsUrl, normalizeHost, parseHandle, type FediAuthor } from './article-author';
import { videoFromObject, type FediVideo } from './fedi-video';

/**
 * A fediverse account shown inside Atlas, read from its own ActivityPub actor and public outbox, so an author tag
 * opens their profile here rather than sending the reader to another site.
 */

export type FediProfilePost = {
  id: string;
  url: string;
  date?: string;
  /** Articles have a title; notes don't. */
  title?: string;
  paragraphs: string[];
  /** Its formatting (rich-text.ts), when it has any; for Misskey-family posts read from their MFM source. */
  rich?: RichBlock[];
  /** Its custom emoji, by shortcode (ActivityPub `Emoji` tags). */
  emojis?: EmojiMap;
  /** The author's content warning; the post body stays folded behind it. */
  cw?: string;
  image?: string;
  /** The author marked its media sensitive: shown behind a veil. */
  sensitive?: boolean;
  /** A video post (PeerTube), playable in place. */
  video?: FediVideo;
};
export type FediProfile = {
  actor: string;
  /** "@name@server". `verified` when the server's WebFinger answers this handle with this same actor. */
  acct: string;
  acctVerified: boolean;
  url: string;
  host: string;
  name: string;
  avatar?: string;
  header?: string;
  bio: string[];
  fields: { name: string; value: string }[];
  joined?: string;
  followers?: number;
  following?: number;
  postCount?: number;
  kind: 'person' | 'group' | 'bot' | 'organization' | 'podcast' | 'channel';
  /** For a podcast (Castopod): its RSS feed and category. */
  podcast?: { feed?: string; category?: string };
  /** Approves followers by hand (Mastodon "locked"). */
  locked: boolean;
  posts: FediProfilePost[];
  /** Why posts are missing, when the server keeps its outbox private. */
  postsHidden?: boolean;
};

/** What a tag passes to open someone: their actor id when known, else their handle. */
export type FediProfileTarget = { actor?: string; acct?: string; name?: string };

/** Castopod's podcast view of an actor (application/podcast-activity+json): feed and category, if it's the same actor. */
export function podcastDetails(doc: unknown, actorId: string): FediProfile['podcast'] | null {
  if (!isObj(doc) || doc.id !== actorId || !list(doc.type).includes('Podcast')) return null;
  const feed = str(doc.rssFeed);
  return { feed: isPublicHttpsUrl(feed) ? feed : undefined, category: cleanText(str(doc.category) ?? '', 100) || undefined };
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const PUBLIC = new Set(['https://www.w3.org/ns/activitystreams#Public', 'as:Public', 'Public']);

/** Drops control characters, zero-width marks and bidi overrides, which can make a remote name lie about itself. */
export function cleanText(s: string, max: number): string {
  return Array.from(s)
    .filter(ch => { const c = ch.codePointAt(0) ?? 0; return !(c <= 0x1f || c === 0x7f || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)); })
    .join('').replace(/\s+/g, ' ').trim().slice(0, max);
}
const text = (html: unknown, max: number) => cleanText(htmlToParagraphs(str(html) ?? '').join(' '), max);
const href = (v: unknown): string | undefined => {
  for (const x of list(v)) {
    const h = typeof x === 'string' ? x : isObj(x) ? (str(x.href) ?? str(x.url)) : undefined;
    if (isPublicHttpsUrl(h)) return h;
  }
  return undefined;
};
const image = (v: unknown) => list(v).map(i => (isObj(i) ? href(i.url) : href(i))).find(Boolean);
const count = (v: unknown) => (isObj(v) && typeof v.totalItems === 'number' && v.totalItems >= 0 ? Math.floor(v.totalItems) : undefined);

/** The handle an actor claims: FEP-2c59 `webfinger` when present, else preferredUsername at the actor's host. */
export function claimedAcct(actor: Json): string | null {
  const own = parseHandle(str(actor.webfinger));
  if (own) return own;
  const id = str(actor.id), user = cleanText(str(actor.preferredUsername) ?? '', 64).replace(/^@/, '');
  if (!id || !user) return null;
  return parseHandle(`${user}@${new URL(id).hostname}`);
}

/** A PeerTube video channel: a Group that only its owners post to (PeerTube sends postingRestrictedToMods) and that
 *  has playlists. Bonfire's own interop notes key on the same flag. */
export function isVideoChannel(actor: Json): boolean {
  return list(actor.type).includes('Group') && actor.postingRestrictedToMods === true && typeof actor.playlists === 'string';
}

/** Actor document → profile (without posts or counts that need more requests). */
export function profileFromActor(actor: Json): Omit<FediProfile, 'posts' | 'acctVerified'> | null {
  const id = str(actor.id);
  if (!id || !isPublicHttpsUrl(id)) return null;
  const acct = claimedAcct(actor);
  const user = cleanText(str(actor.preferredUsername) ?? '', 64);
  const name = cleanText(str(actor.name) ?? '', 80) || user;
  if (!acct || !name) return null;
  const types = list(actor.type).map(String);
  const fields = list(actor.attachment).filter(isObj)
    .filter(f => list(f.type).includes('PropertyValue'))
    .map(f => ({ name: cleanText(str(f.name) ?? '', 60), value: text(f.value, 200) }))
    .filter(f => f.name && f.value).slice(0, 8);
  const published = str(actor.published);
  return {
    actor: id, acct: `@${acct}`, url: href(actor.url) ?? id, host: normalizeHost(new URL(id).hostname), name,
    avatar: image(actor.icon), header: image(actor.image),
    bio: htmlToParagraphs(str(actor.summary) ?? '').map(p => cleanText(p, 600)).filter(Boolean).slice(0, 8),
    fields, joined: published && !Number.isNaN(Date.parse(published)) ? published : undefined,
    followers: count(actor.followers), following: count(actor.following), postCount: count(actor.outbox),
    kind: types.includes('Podcast') ? 'podcast' : isVideoChannel(actor) ? 'channel' : types.includes('Group') ? 'group' : types.includes('Service') || types.includes('Application') ? 'bot' : types.includes('Organization') ? 'organization' : 'person',
    locked: actor.manuallyApprovesFollowers === true,
  };
}

const isPublic = (o: Json) => [...list(o.to), ...list(o.cc)].some(a => typeof a === 'string' && PUBLIC.has(a));
const POST_TYPES = new Set(['Note', 'Article', 'Page', 'Question', 'Video', 'Audio', 'Event']);

/** An outbox page → the author's own public posts (boosts and non-public items are left out). */
export function postsFromOutbox(page: unknown, actorId: string, max = 10,
  /** Formatting from a source the server reads (Misskey's MFM: mfm.ts, kept out of the browser bundle). */
  sourceRich?: (o: Record<string, unknown>) => RichBlock[] | undefined): FediProfilePost[] {
  if (!isObj(page)) return [];
  const actorHost = normalizeHost(new URL(actorId).hostname);
  const out: FediProfilePost[] = [];
  for (const item of list(page.orderedItems ?? page.items)) {
    if (out.length >= max) break;
    if (!isObj(item) || !list(item.type).includes('Create') || !isObj(item.object)) continue;
    const o = item.object;
    const id = str(o.id);
    if (!id || !isPublicHttpsUrl(id) || normalizeHost(new URL(id).hostname) !== actorHost) continue;
    if (!list(o.type).some(t => POST_TYPES.has(String(t))) || !isPublic(o) || !isPublic(item)) continue;
    const by = list(o.attributedTo).map(a => (isObj(a) ? str(a.id) : str(a)));
    if (!by.includes(actorId)) continue;
    const isArticle = list(o.type).includes('Article');
    const titled = isArticle || list(o.type).includes('Video');
    const title = titled ? cleanText(str(o.name) ?? '', 200) || undefined : undefined;
    const body = htmlToParagraphs(str(o.content) ?? '').map(p => cleanText(p, 1200)).filter(Boolean);
    const summary = cleanText(htmlToParagraphs(str(o.summary) ?? '').join(' '), 300);
    // On notes, `summary` is the content warning; on articles it's the standfirst.
    const cw = !isArticle && summary ? summary : undefined;
    const paragraphs = isArticle && summary ? [summary] : body.slice(0, 6);
    const img = list(o.attachment).filter(isObj)
      .find(a => (str(a.mediaType) ?? '').startsWith('image/') || list(a.type).includes('Image'));
    const published = str(o.published);
    out.push({
      id, url: href(o.url) ?? id, date: published && !Number.isNaN(Date.parse(published)) ? published : undefined,
      title, paragraphs, cw, image: img ? href(img.url) : undefined,
      ...(o.sensitive === true ? { sensitive: true } : {}),
      ...(() => {
        if (isArticle && summary) return {};
        const r = sourceRich?.(o) ?? htmlToRich(str(o.content));
        return r ? { rich: r.slice(0, 12) } : {};
      })(),
      ...(() => { const e = emojiMap(list(o.tag)); return e ? { emojis: e } : {}; })(),
      ...(() => { const v = list(o.type).includes('Video') ? videoFromObject(o) : null; return v ? { video: v } : {}; })(),
    });
  }
  return out;
}

/* ── Opening a profile from anywhere (author tags in feeds, Spotlight, Saved) ──────────────────────── */

export const OPEN_FEDI_PROFILE_EVENT = 'atlas:open-fedi-profile';
export function openFediProfile(target: FediProfileTarget | Pick<FediAuthor, 'actor' | 'acct' | 'name'>): void {
  if (typeof window === 'undefined') return;
  const actor = isPublicHttpsUrl(target.actor) ? target.actor : undefined;
  const acct = parseHandle(target.acct) ?? undefined;
  if (!actor && !acct) return;
  window.dispatchEvent(new CustomEvent<FediProfileTarget>(OPEN_FEDI_PROFILE_EVENT, { detail: { actor, acct, name: target.name } }));
}
