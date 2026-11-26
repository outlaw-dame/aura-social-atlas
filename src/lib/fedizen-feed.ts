/** Browser-safe Fedizen (Mastodon-compatible) feed types, normalizers and redirect allowlist. */
import { relayFromAcct, type Relayed } from './fedibuzz';
import { emojiMap, htmlToRich, type EmojiMap, type RichBlock } from './rich-text';
import { htmlToParagraphs } from './spotlight';
import { collectionLinksIn, mastodonCollectionApi } from './collections';
import { isPublicHttpsUrl, parseHandle, type FediAuthor } from './article-author';
import type { FediEpisode } from './podcast-episode';
import { videoFromAttachment, watchUrlFor, type FediVideo } from './fedi-video';

export const FEDIZEN = 'https://fedizen.net';
/** Fedizen's own pages for what its API doesn't offer yet (Bonfire v1.1.0-rc.1: bonfire_ui_me SafetyLive, bonfire_ui_boundaries BoundariesLive). */
export const FEDIZEN_KEYWORD_FILTERS_URL = `${FEDIZEN}/settings/user/safety`;
export const FEDIZEN_BLOCKED_URL = `${FEDIZEN}/settings/boundaries/blocked`;
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

export type FedizenPost = { /** Deleted, or gone from the conversation, while it was open: kept as a placeholder so its replies keep their place (thread-live.ts). */ tombstone?: boolean; id: string; /** The post itself (the boosted one for a boost), for bookmarking. */ statusId?: string; /** Native Home only: the status id of a card shown before its details were read (bonfire-private.server); read afterwards, never used for actions. */ statusRef?: string; bookmarked?: boolean; author: string; handle: string; avatar?: string; paragraphs: string[]; /** Its formatting (rich-text.ts), when it has any: bold, code, quotes, Misskey's MFM… */ rich?: RichBlock[]; /** Its custom emoji, by shortcode. */ emojis?: EmojiMap; url: string; /** Its ActivityPub id, to match it with the same post read from its author's server. */ uri?: string; date?: string; image?: string; /** The image's width and height (from Fedizen's media meta), to reserve its space before it loads. */ imageSize?: { w: number; h: number }; /** The author marked its media sensitive. */ sensitive?: boolean; boostedBy?: string;
  /** The author's actor and full handle, to open their profile in Atlas. */ actor?: string; acct?: string;
  /** Who boosted it (boostedBy is their name), to show their avatar and open their profile. */ booster?: FediPerson;
  /** Pushed to Fedizen by a FediBuzz relay the person follows (a hashtag, a server or a language): shown as where it came from. */ relayed?: Relayed;
  /** The people the post mentions, as Fedizen resolved them: "@name" in the text opens theirs. */ mentions?: FediMention[];
  /** The post this one replies to: its id, and the post itself once Atlas has read it from Fedizen (absent when
   *  Fedizen won't show it to the reader, eg. its author is blocked). */ replyTo?: { statusId: string; post?: FedizenPost };
  /** Mastodon collections linked in the post. */ collections?: string[];
  /** A video attached to the post (a federated PeerTube video arrives this way). */ video?: FediVideo;
  /** The article the post links to, and who wrote it as far as Atlas can verify ("More from"). */ article?: PostArticle;
  /** Reply, boost and like counts, and whether the person has liked or boosted it (Fedizen statuses only). */
  counts?: { replies: number; boosts: number; likes: number }; liked?: boolean; boosted?: boolean;
  /** Who can see it; a reply keeps to this audience. */ visibility?: 'public' | 'unlisted' | 'private' | 'direct';
  /** The language its author set (a BCP 47 tag, Mastodon's `language`), for translation (lib/translation). */ language?: string;
  /** What keyword filters read besides the text: content warning, hashtags, image descriptions, link preview, poll
   *  options, the quoted post's words, and the author's account id (for "except people I follow"). */
  cw?: string; tags?: string[]; alt?: string[]; linkTitle?: string; linkDescription?: string; poll?: string[]; quote?: string; authorId?: string;
  /** The poll itself: options with counts, and whether the reader voted (Mastodon Poll). */ pollState?: FediPoll;
  /** When its author last edited it. */ editedAt?: string };
/** A poll as Fedizen reports it (Mastodon Poll). Counts may be absent while a poll hides them. */
export type FediPoll = { id: string; options: { title: string; votes?: number }[]; multiple: boolean; expired: boolean; expiresAt?: string; votes?: number; voters?: number; voted: boolean; ownVotes: number[] };
/** Someone shown beside a post (who boosted it), with what opens their profile. */
export type FediPerson = { name: string; avatar?: string; acct?: string; actor?: string };
/** A mention: the full handle, and the name it's written as in the text (the handle's first part). */
export type FediMention = { acct: string; username: string };
export type PostArticle = { url: string; title?: string; provider?: string; byline?: string; /** The preview's summary and image. */ description?: string; image?: string; /** The preview's author link: checked for an ActivityPub account, never shown as-is. */ authorUrl?: string; authors?: FediAuthor[]; /** A podcast episode Atlas can play in place. */ episode?: FediEpisode; /** A video (PeerTube) Atlas can play in place. */ video?: FediVideo };
export type FedizenNotice = { id: string; type: string; author: string; avatar?: string; date?: string; text: string; /** Who did it, to open their profile in Atlas. */ acct?: string; actor?: string; /** The post it's about, to open its conversation. */ statusId?: string };
/** A direct conversation (Mastodon `Conversation`): the other people in it and its latest message, as plain text. */
export type FedizenConversation = { id: string; unread: boolean; people: { name: string; handle: string; avatar?: string }[]; text: string; date?: string; url?: string };

type Acct = { id?: string; display_name?: string; acct?: string; username?: string; avatar?: string; url?: string | null; uri?: string | null };
type Status = { id: string; url?: string | null; uri?: string; created_at?: string; content?: string; emojis?: unknown; account?: Acct; reblog?: Status | null; media_attachments?: { type?: string; url?: string; preview_url?: string; remote_url?: string | null; description?: string | null; meta?: unknown }[]; bookmarked?: boolean | null; sensitive?: boolean | null; card?: { url?: string | null; title?: string | null; provider_name?: string | null; author_name?: string | null; author_url?: string | null; description?: string | null; image?: string | null } | null;
  replies_count?: number | null; reblogs_count?: number | null; favourites_count?: number | null; favourited?: boolean | null; reblogged?: boolean | null; visibility?: FedizenPost['visibility'] | null; language?: string | null;
  in_reply_to_id?: string | null; in_reply_to_account_id?: string | null; spoiler_text?: string | null; tags?: { name?: string }[] | null; mentions?: { acct?: string | null; username?: string | null }[] | null; poll?: { id?: string; expires_at?: string | null; expired?: boolean | null; multiple?: boolean | null; votes_count?: number | null; voters_count?: number | null; voted?: boolean | null; own_votes?: number[] | null; options?: { title?: string; votes_count?: number | null }[] } | null; edited_at?: string | null;
  quote?: { quoted_status?: { content?: string | null; spoiler_text?: string | null; media_attachments?: { description?: string | null }[] | null } | null } | null };
type Notice = { id: string; type?: string; created_at?: string; account?: Acct; status?: Status | null };

const http = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u : undefined);
/** Fedizen's stand-in picture for an account whose own it hasn't fetched (often a Lemmy or PieFed account). It isn't
 *  their avatar: Atlas reads theirs from their actor instead (withActorAvatars), or shows their initial. */
export function isPlaceholderAvatar(u?: string | null): boolean {
  try { const x = new URL(u ?? ''); return x.hostname === new URL(FEDIZEN).hostname && x.pathname === '/images/avatar.png'; } catch { return false; }
}
const avatarOf = (a?: Acct) => { const u = http(a?.avatar); return u && !isPlaceholderAvatar(u) ? u : undefined; };
/** Their display name, or else the first part of their handle. Bonfire gives a remote account's full handle as its
 *  username, and for accounts with no display name (many Lemmy and PieFed ones) as its display name too, so a
 *  display name that is just the handle counts as none ("Unboxious", not "Unboxious@ani.social" twice). */
const name = (a?: Acct) => {
  const handle = (s?: string | null) => (s ?? '').trim().replace(/^@/, '').toLowerCase();
  const dn = a?.display_name?.trim();
  // Only a full handle (with its server) counts: a display name "Anime" for @anime is a real one.
  const isHandle = !!dn && handle(dn).includes('@') && [a?.acct, a?.username].some(h => handle(h) === handle(dn));
  return (!isHandle && dn) || (a?.username || a?.acct || '').replace(/^@/, '').split('@')[0] || 'Someone';
};

/** A Mastodon Poll (in a status, or answered by voting) as Atlas shows it; null when it isn't one. */
export function pollOf(p?: Status['poll'] | null): FediPoll | null {
  if (!p?.id || !/^[A-Za-z0-9_-]{1,64}$/.test(p.id)) return null;
  const options = (p.options ?? []).map(o => ({ title: (o.title ?? '').trim(), ...(typeof o.votes_count === 'number' ? { votes: o.votes_count } : {}) })).filter(o => o.title);
  if (options.length < 2) return null;
  const expiresAt = p.expires_at && !Number.isNaN(Date.parse(p.expires_at)) ? p.expires_at : undefined;
  const expired = p.expired === true || (!!expiresAt && Date.parse(expiresAt) <= Date.now());
  return {
    id: p.id, options, multiple: p.multiple === true, expired, ...(expiresAt ? { expiresAt } : {}),
    ...(typeof p.votes_count === 'number' ? { votes: p.votes_count } : {}), ...(typeof p.voters_count === 'number' ? { voters: p.voters_count } : {}),
    voted: p.voted === true, ownVotes: (p.own_votes ?? []).filter(i => Number.isInteger(i) && i >= 0 && i < options.length),
  };
}

/** A handle as Fedizen gives it, made whole: Fedizen's own members come without the domain. */
export function fullAcct(raw?: string | null): string | undefined {
  const v = (raw ?? '').trim().replace(/^@/, '');
  if (!v) return undefined;
  return parseHandle(v.includes('@') ? v : `${v}@${new URL(FEDIZEN).hostname}`) ?? undefined;
}
const person = (a?: Acct): FediPerson => {
  const acct = fullAcct(a?.acct), actor = isPublicHttpsUrl(a?.uri) ? a!.uri! : isPublicHttpsUrl(a?.url) ? a!.url! : undefined;
  const avatar = avatarOf(a);
  return { name: name(a), ...(avatar ? { avatar } : {}), ...(acct ? { acct } : {}), ...(actor ? { actor } : {}) };
};
const mentionsOf = (o: Status): FediMention[] => (o.mentions ?? []).flatMap(m => {
  const acct = fullAcct(m.acct ?? m.username);
  return acct ? [{ acct, username: acct.split('@')[0] }] : [];
});

/** An image's shape from Mastodon-style media meta (original first, then the preview's), if it's sane. */
export function imageSizeOf(meta: unknown): { w: number; h: number } | undefined {
  const m = meta as { original?: { width?: unknown; height?: unknown } | null; small?: { width?: unknown; height?: unknown } | null } | null | undefined;
  for (const s of [m?.original, m?.small]) {
    const w = Number(s?.width), h = Number(s?.height);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && w <= 100_000 && h <= 100_000 && w / h < 20 && h / w < 20) return { w: Math.round(w), h: Math.round(h) };
  }
  return undefined;
}

/** A language tag as a status gives it, when it is one (BCP 47 shape: `ja`, `pt-BR`, `zh-Hant`). */
export function languageTag(v: unknown): string | undefined {
  return typeof v === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/i.test(v.trim()) ? v.trim() : undefined;
}

export function fromStatuses(list: Status[]): FedizenPost[] {
  return list.map(s => {
    const o = s.reblog ?? s;
    return {
      id: s.id, statusId: o.id, bookmarked: o.bookmarked === true || s.bookmarked === true, author: name(o.account), handle: `@${o.account?.acct ?? ''}`, avatar: avatarOf(o.account),
      paragraphs: htmlToParagraphs(o.content ?? ''), url: http(o.url) ?? http(o.uri) ?? FEDIZEN, ...(http(o.uri) ? { uri: http(o.uri) } : {}), date: o.created_at,
      ...(() => { const r = htmlToRich(o.content); return r ? { rich: r } : {}; })(),
      ...(() => { const e = emojiMap(o.emojis); return e ? { emojis: e } : {}; })(),
      image: http(o.media_attachments?.find(m => m.type === 'image')?.preview_url ?? o.media_attachments?.find(m => m.type === 'image')?.url),
      ...(() => { const size = imageSizeOf(o.media_attachments?.find(m => m.type === 'image')?.meta); return size ? { imageSize: size } : {}; })(),
      // A FediBuzz relay's boost is where the post came from (a hashtag, a server), not someone who boosted it.
      ...(() => {
        if (!s.reblog) return {};
        const relayed = relayFromAcct(s.account?.acct);
        return relayed ? { relayed } : { boostedBy: name(s.account), booster: person(s.account) };
      })(),
      ...(() => { const a = person(o.account); return { ...(a.acct ? { acct: a.acct } : {}), ...(a.actor ? { actor: a.actor } : {}) }; })(),
      ...(() => { const m = mentionsOf(o); return m.length ? { mentions: m } : {}; })(),
      ...(o.in_reply_to_id && /^[A-Za-z0-9_-]{1,64}$/.test(o.in_reply_to_id) ? { replyTo: { statusId: o.in_reply_to_id } } : {}),
      ...(o.sensitive === true && o.media_attachments?.length ? { sensitive: true } : {}),
      ...(typeof o.replies_count === 'number' || typeof o.reblogs_count === 'number' || typeof o.favourites_count === 'number'
        ? { counts: { replies: o.replies_count ?? 0, boosts: o.reblogs_count ?? 0, likes: o.favourites_count ?? 0 } } : {}),
      ...(o.favourited === true ? { liked: true } : {}), ...(o.reblogged === true ? { boosted: true } : {}),
      ...(o.visibility ? { visibility: o.visibility } : {}),
      ...(() => { const l = languageTag(o.language); return l ? { language: l } : {}; })(),
      ...(o.spoiler_text?.trim() ? { cw: o.spoiler_text.trim() } : {}),
      ...(() => { const t = (o.tags ?? []).map(x => x.name).filter((n): n is string => !!n); return t.length ? { tags: t } : {}; })(),
      ...(() => { const a = (o.media_attachments ?? []).map(m => m.description?.trim()).filter((d): d is string => !!d); return a.length ? { alt: a } : {}; })(),
      ...(o.card?.title ? { linkTitle: o.card.title } : {}),
      ...(o.card?.description ? { linkDescription: o.card.description } : {}),
      ...(o.account?.id ? { authorId: o.account.id } : {}),
      ...(() => { const p = (o.poll?.options ?? []).map(x => x.title?.trim()).filter((t): t is string => !!t); return p.length ? { poll: p } : {}; })(),
      ...(() => { const p = pollOf(o.poll); return p ? { pollState: p } : {}; })(),
      ...(o.edited_at && !Number.isNaN(Date.parse(o.edited_at)) ? { editedAt: o.edited_at } : {}),
      ...(() => {
        const q = o.quote?.quoted_status;
        if (!q) return {};
        const text = [q.spoiler_text ?? '', ...htmlToParagraphs(q.content ?? ''), ...(q.media_attachments ?? []).map(m => m.description ?? '')].map(t => t.trim()).filter(Boolean).join('\n');
        return text ? { quote: text.slice(0, 2000) } : {};
      })(),
      ...(() => { for (const m of o.media_attachments ?? []) { const v = videoFromAttachment(m, http(o.url) ?? http(o.uri) ?? FEDIZEN); if (v) return { video: v }; } return {}; })(),
      ...(() => { const c = collectionLinksIn(o.content ?? ''); return c.length ? { collections: c } : {}; })(),
      ...(() => { const a = articleOf(o); return a ? { article: a } : {}; })(),
    };
  });
}

/** Mastodon's notification types (docs.joinmastodon.org/entities/Notification), worded as Mastodon words them. */
const verbs: Record<string, string> = {
  favourite: 'liked your post', reblog: 'boosted your post', follow: 'followed you', mention: 'mentioned you', status: 'posted', poll: 'poll ended',
  follow_request: 'asked to follow you', reply: 'replied to you', update: 'edited a post you boosted', quote: 'quoted your post', quoted_update: 'edited a post you quoted',
  'admin.sign_up': 'signed up', 'admin.report': 'filed a report', severed_relationships: 'some of your follows were cut off', moderation_warning: 'moderators took action on your account',
  added_to_collection: 'added you to a collection', collection_update: 'updated a collection you’re in',
};
export function fromNotifications(list: Notice[]): FedizenNotice[] {
  return list.map(n => ({
    id: n.id, type: n.type ?? 'other', author: name(n.account), avatar: avatarOf(n.account), date: n.created_at,
    ...(() => { const a = person(n.account); return { ...(a.acct ? { acct: a.acct } : {}), ...(a.actor ? { actor: a.actor } : {}) }; })(),
    ...(n.status?.id ? { statusId: n.status.id } : {}),
    text: `${verbs[n.type ?? ''] ?? 'interacted with you'}${n.status?.content ? ` — ${htmlToParagraphs(n.status.content).join(' ').slice(0, 140)}` : ''}`,
  }));
}

/**
 * A grouped notification (Mastodon 4.3's /api/v2/notifications): "Ann, Ben and 3 others liked your post". Mastodon and
 * Bonfire group likes, boosts and follows; Bonfire groups within each page it returns, so groups of the same kind on the
 * same post that land on different pages are merged here (mergeNoticeGroups). `people` are the sample, newest first.
 *
 * Atlas reads more out of each than Mastodon's own app shows, as Bluesky does: whether a post is a reply, and to whom
 * (Bonfire sends a reply that doesn't name you as `status`, which Mastodon words "posted"; Mastodon sends every reply
 * as `mention`), the whole post for replies, mentions and quotes (to answer, like or boost in place), your post's
 * picture for likes and boosts, and when the post is gone.
 */
export type NoticePost = { id: string; text: string; url?: string; image?: string };
export type FedizenNoticeGroup = {
  /** Kind: Mastodon's type, except `reply` for a reply (Bluesky has one; Mastodon and Bonfire don't). */
  key: string; type: string; count: number; date?: string; people: (FediPerson & { id?: string })[];
  /** The post it's about (yours for likes and boosts; theirs for mentions and replies), as plain text. */
  post?: NoticePost;
  /** Several of your posts one person liked or boosted ("Ann liked 3 of your posts"), newest first (combineMultiPost). */
  posts?: NoticePost[];
  /** The whole post, for a reply, mention, quote or new post: shown with its actions. */
  status?: FedizenPost;
  /** Fedizen named a post that's no longer there (deleted, or no longer visible to you). */
  gone?: true;
  /** The collection it's about (added_to_collection, collection_update), as its Mastodon page. */
  collection?: string;
  /** The newest notification in it (Mastodon most_recent_notification_id), to tell read from unread. */
  latestId?: string;
  /** Mastodon's own wording for one, e.g. "mentioned you". */ verb: string;
};
type Grouped = {
  accounts?: (Acct & { id?: string | null })[] | null;
  statuses?: Status[] | null;
  notification_groups?: { group_key: string; notifications_count?: number | null; type?: string | null; latest_page_notification_at?: string | null; most_recent_notification_id?: string | number | null; sample_account_ids?: string[] | null; status_id?: string | null; collection?: { url?: string | null } | null }[] | null;
};
export const GROUPABLE = new Set(['favourite', 'reblog', 'follow']);
/** Kinds whose post is someone else's, shown whole. */
export const CONVERSATION_KINDS = new Set(['mention', 'reply', 'status', 'quote']);

/**
 * What a post-carrying notification is, read from the post: a reply to you, a reply elsewhere, or not a reply. `meId`
 * is the reader's Fedizen account id, when known.
 */
export function replyKind(type: string, st: Pick<Status, 'in_reply_to_id' | 'in_reply_to_account_id'> | undefined, meId?: string): { type: string; verb?: string } {
  if (!st?.in_reply_to_id || (type !== 'mention' && type !== 'status')) return { type };
  const toMe = meId && st.in_reply_to_account_id ? st.in_reply_to_account_id === meId : undefined;
  if (toMe) return { type: 'reply', verb: 'replied to you' };
  // A mention in a reply to someone else is still a mention; a reply that names nobody reached you some other way.
  if (type === 'mention') return { type };
  return { type: 'reply', verb: toMe === false ? 'replied in a conversation' : 'replied' };
}

export function fromGroupedNotifications(g: Grouped, meId?: string): FedizenNoticeGroup[] {
  const accounts = new Map((g.accounts ?? []).filter(a => a?.id).map(a => [a.id!, a]));
  const statuses = new Map((g.statuses ?? []).filter(s => s?.id).map(s => [s.id, s]));
  return (g.notification_groups ?? []).filter(n => n && typeof n.group_key === 'string').map(n => {
    const st = n.status_id ? statuses.get(n.status_id) : undefined;
    const r = replyKind(n.type ?? 'other', st, meId);
    const type = r.type;
    const people = (n.sample_account_ids ?? []).flatMap(id => { const a = accounts.get(id); return a ? [{ ...person(a), id }] : []; });
    const text = st?.content ? htmlToParagraphs(st.content).join(' ').slice(0, 200) : '';
    const image = st ? http((st.media_attachments ?? []).find(m => m.type === 'image')?.preview_url ?? (st.media_attachments ?? []).find(m => m.type === 'image')?.url) : undefined;
    const latest = n.most_recent_notification_id == null ? undefined : String(n.most_recent_notification_id);
    return {
      key: n.group_key, type, count: Math.max(1, n.notifications_count ?? people.length ?? 1), date: n.latest_page_notification_at ?? undefined, people,
      verb: r.verb ?? verbs[type] ?? 'interacted with you',
      ...(st ? { post: { id: st.id, text, ...(http(st.url) ?? http(st.uri) ? { url: http(st.url) ?? http(st.uri) } : {}), ...(image ? { image } : {}) } } : {}),
      ...(st && CONVERSATION_KINDS.has(type) ? { status: fromStatuses([st])[0] } : {}),
      ...(n.status_id && !st ? { gone: true as const } : {}),
      ...(n.collection?.url && mastodonCollectionApi(n.collection.url) ? { collection: n.collection.url } : {}),
      ...(latest && /^[A-Za-z0-9_-]{1,64}$/.test(latest) ? { latestId: latest } : {}),
    };
  });
}

/**
 * Joins groups of the same kind on the same post (and all follows) across pages, as one: the count adds up and the
 * people are merged, newest first. Ungroupable kinds (mentions, replies, polls…) stay one per notification.
 */
export function mergeNoticeGroups(groups: FedizenNoticeGroup[]): FedizenNoticeGroup[] {
  const out: FedizenNoticeGroup[] = [];
  const at = new Map<string, number>();
  for (const g of groups) {
    const k = GROUPABLE.has(g.type) ? `${g.type}|${g.post?.id ?? ''}` : null;
    const i = k ? at.get(k) : undefined;
    if (i === undefined) { if (k) at.set(k, out.length); out.push(g); continue; }
    const m = out[i];
    const seen = new Set(m.people.map(p => p.acct ?? p.actor ?? p.name));
    out[i] = { ...m, count: m.count + g.count, people: [...m.people, ...g.people.filter(p => !seen.has(p.acct ?? p.actor ?? p.name))] };
  }
  return out;
}

/** What a reply, mention, quote or new post is, above the post itself: "Replied to you", "Quoted your post". */
export function noticeLabel(g: Pick<FedizenNoticeGroup, 'type' | 'verb'>): string {
  const v = g.type === 'status' && g.verb === 'posted' ? 'new post' : g.verb;
  return v.charAt(0).toUpperCase() + v.slice(1);
}

const DAY = 86_400_000;
/**
 * One person liking or boosting several of your posts within a day, as one row ("Ann liked 3 of your posts"), as
 * Bluesky groups them. Mastodon and Bonfire only group many people on one post, so a reader who shares a thread and
 * gets five likes from one friend sees five rows there. Only single-person, single-post groups are joined.
 */
export function combineMultiPost(groups: FedizenNoticeGroup[]): FedizenNoticeGroup[] {
  const out: FedizenNoticeGroup[] = [];
  const at = new Map<string, number>();
  for (const g of groups) {
    const who = g.people.length === 1 && g.count === 1 ? g.people[0].acct ?? g.people[0].actor : undefined;
    const k = (g.type === 'favourite' || g.type === 'reblog') && who && g.post ? `${g.type}|${who}` : null;
    const i = k ? at.get(k) : undefined;
    const m = i === undefined ? undefined : out[i];
    const near = m && (!m.date || !g.date || Date.parse(m.date) - Date.parse(g.date) <= DAY);
    if (k && m && near && g.post && !(m.posts ?? (m.post ? [m.post] : [])).some(p => p.id === g.post!.id)) {
      const posts = [...(m.posts ?? (m.post ? [m.post] : [])), g.post];
      out[i!] = { ...m, posts, count: posts.length, verb: `${g.type === 'favourite' ? 'liked' : 'boosted'} ${posts.length} of your posts` };
      continue;
    }
    if (k) at.set(k, out.length);
    out.push(g);
  }
  return out;
}

/**
 * Which of two notification ids is newer. Mastodon's are numbers in a string (Snowflake ids, compared by length then
 * digits); Bonfire's are ULIDs, which sort as text. Either way: longer is newer, then the larger.
 */
export function newerId(a: string, b: string): boolean {
  return a.length !== b.length ? a.length > b.length : a > b;
}
/** Not yet read: newer than the reader's notifications marker (Mastodon /api/v1/markers, which Bonfire keeps too). */
export const isUnreadGroup = (g: Pick<FedizenNoticeGroup, 'latestId'>, lastRead: string | null | undefined): boolean =>
  !!lastRead && !!g.latestId && newerId(g.latestId, lastRead);

/** Activity's tabs, as Bluesky's: everything, replies (with mentions and quotes), follows, and people you follow. */
export type NoticeFilter = 'all' | 'replies' | 'follows' | 'following';
/** Mastodon types[] each tab asks Fedizen for (People you follow is read from All and kept to people you follow). */
export const FILTER_TYPES: Record<NoticeFilter, string[] | null> = {
  all: null, following: null, replies: ['mention', 'status', 'quote'], follows: ['follow', 'follow_request'],
};
/** What a tab keeps of what Fedizen sent: Replies leaves out new posts from people you get alerts for. */
export function inFilter(g: FedizenNoticeGroup, f: NoticeFilter, followed?: ReadonlySet<string>): boolean {
  if (f === 'replies') return g.type === 'reply' || g.type === 'mention' || g.type === 'quote';
  if (f === 'follows') return g.type === 'follow' || g.type === 'follow_request';
  if (f === 'following') return g.people.some(p => !!p.id && !!followed?.has(p.id));
  return true;
}

/** "Ann liked your post", "Ann and Ben…", "Ann, Ben and 3 others…", as Mastodon and Bluesky word a group. */
export function groupSentence(g: Pick<FedizenNoticeGroup, 'people' | 'count' | 'verb'> & Partial<Pick<FedizenNoticeGroup, 'posts'>>): { names: string; rest: string } {
  const names = g.people.slice(0, 2).map(p => p.name);
  // One person's likes on several posts count posts, not people.
  const others = Math.max(0, (g.posts ? g.people.length : g.count) - names.length);
  const who = !names.length ? (g.count === 1 ? 'Someone' : `${g.count} people`)
    : others === 0 ? names.join(' and ')
    : `${names.join(', ')} and ${others === 1 ? '1 other' : `${others} others`}`;
  return { names: who, rest: g.verb };
}

type Conversation = { id: string; unread?: boolean; accounts?: Acct[]; last_status?: Status | null };
export function fromConversations(list: Conversation[]): FedizenConversation[] {
  return list.filter(c => c && typeof c.id === 'string').map(c => ({
    id: c.id, unread: c.unread === true,
    people: (c.accounts ?? []).map(a => ({ name: name(a), handle: `@${a.acct ?? a.username ?? ''}`, avatar: http(a.avatar) })),
    text: htmlToParagraphs(c.last_status?.content ?? '').join(' ').slice(0, 200),
    date: c.last_status?.created_at, url: http(c.last_status?.url) ?? http(c.last_status?.uri),
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

/**
 * Atlas's own Lovable project, the only Lovable hosts a Fedizen callback may return to when
 * ATLAS_FEDIZEN_CALLBACK_ORIGINS isn't set. Any *.lovable.app used to pass, so another Lovable tenant could have
 * Atlas register a Fedizen app that returns grants to it. Lovable's hosts for a project: the editor preview
 * id-preview(-<build>)--<project id>.lovable.app, project--<project id>(-dev).lovable.app (also on Supabase's redirect
 * list), <project id>.lovableproject.com, preview--<slug>.lovable.app and
 * the published <slug>.lovable.app; and Atlas's domain, atlas-social.space. Another domain or a renamed project sets
 * ATLAS_FEDIZEN_CALLBACK_ORIGINS (which then replaces this list).
 */
export const ATLAS_LOVABLE_PROJECT = { id: 'd3fdefe8-1c72-40dc-8fa6-0b966befbe5b', slug: 'aura-social-atlas' } as const;
/** Atlas's own domain, where the app is published. */
export const ATLAS_DOMAIN = 'atlas-social.space';
export function isAtlasLovableHost(host: string): boolean {
  const { id, slug } = ATLAS_LOVABLE_PROJECT;
  const h = host.toLowerCase();
  return h === ATLAS_DOMAIN || h === `www.${ATLAS_DOMAIN}` ||
    new RegExp(`^id-preview(?:-[a-z0-9]{1,40})?--${id}\\.lovable\\.app$`).test(h) ||
    new RegExp(`^project--${id}(?:-dev)?\\.lovable\\.app$`).test(h) ||
    h === `${id}.lovableproject.com` ||
    h === `preview--${slug}.lovable.app` ||
    h === `${slug}.lovable.app`;
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
    allowed = (requested.protocol === 'https:' && isAtlasLovableHost(requested.hostname)) ||
      (requested.protocol === 'http:' && requested.hostname === 'localhost');
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

/** A Bonfire circle (served to Mastodon clients as a List): a named group of people you choose. */
export type FedizenCircle = { id: string; title: string; /** Only from GraphQL (REST lists have no description). */ summary?: string };
/** Someone in a circle, or found by handle to add to one. */
export type FedizenPerson = { id: string; name: string; handle: string; avatar?: string };

export function fromLists(list: { id: string; title?: string | null }[]): FedizenCircle[] {
  return list.filter(l => l && typeof l.id === 'string').map(l => ({ id: l.id, title: (l.title ?? '').trim() || 'Untitled circle' }));
}
export function fromAccounts(list: Acct[]): FedizenPerson[] {
  return list.filter(a => a && typeof a.id === 'string' && a.id).map(a => ({ id: a.id!, name: name(a), handle: `@${a.acct ?? a.username ?? ''}`, avatar: avatarOf(a) }));
}
/** "@name@server", "name@server" or "name" → what Mastodon's account lookup takes, or null. */
export function lookupAcct(handle: string): string | null {
  const h = handle.trim().replace(/^@/, '');
  return /^[A-Za-z0-9_.-]{1,64}(@[A-Za-z0-9.-]{1,253})?$/.test(h) ? h : null;
}

/**
 * The article a post links to: Bonfire's link preview when it has one, else the first ordinary link in the text.
 * Mentions, hashtags and Mastodon collection links are not articles. Only public https URLs.
 */
/** Credits worth showing on a post: not the post's own author (a podcast sharing its own episode, say). */
export function creditsBesidesAuthor(post: Pick<FedizenPost, 'handle'>, authors: FediAuthor[]): FediAuthor[] {
  const own = post.handle.toLowerCase();
  return own.includes('@', 1) ? authors.filter(a => a.acct.toLowerCase() !== own) : authors;
}

export function articleLinkIn(html: string): string | undefined {
  for (const m of html.matchAll(/<a\s([^>]{0,1000})>/gi)) {
    const attrs = m[1];
    const href = /href\s*=\s*"([^"]{1,2048})"/i.exec(attrs)?.[1]?.replace(/&amp;/g, '&');
    if (!href || /class\s*=\s*"[^"]*\b(mention|hashtag|u-url)\b/i.test(attrs) || /rel\s*=\s*"[^"]*\btag\b/i.test(attrs)) continue;
    if (isPublicHttpsUrl(href) && !mastodonCollectionApi(href)) return href;
  }
  return undefined;
}
function articleOf(o: Status): PostArticle | undefined {
  const card = o.card;
  const linked = card?.url && isPublicHttpsUrl(card.url) && !mastodonCollectionApi(card.url) ? card.url : articleLinkIn(o.content ?? '');
  if (!linked) return undefined;
  // A PeerTube embed link resolves through its watch page.
  const url = watchUrlFor(linked);
  const fromCard = card?.url === linked;
  const clip = (v?: string | null, n = 200) => (v && v.trim() ? v.trim().slice(0, n) : undefined);
  const authorUrl = fromCard && isPublicHttpsUrl(card?.author_url) ? card!.author_url! : undefined;
  const image = fromCard && isPublicHttpsUrl(card?.image) ? card!.image! : undefined;
  return { url, title: fromCard ? clip(card?.title, 300) : undefined, provider: fromCard ? clip(card?.provider_name, 100) : undefined, byline: fromCard ? clip(card?.author_name, 100) : undefined,
    ...(() => { const d = fromCard ? clip(card?.description, 400) : undefined; return d ? { description: d } : {}; })(), ...(image ? { image } : {}), ...(authorUrl ? { authorUrl } : {}) };
}
