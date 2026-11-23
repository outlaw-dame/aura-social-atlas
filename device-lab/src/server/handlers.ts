/**
 * Sample answers, module by module (see index.ts). Inputs are what the app sends; results are typed against the
 * real server functions there. Changes made through the app (likes, saves, joins, follows, posts, circles,
 * collections, filters) live in memory until the page reloads.
 */
import type * as Bonfire from '@/lib/bonfire.functions';
import type * as BonfirePrivate from '@/lib/bonfire-private.functions';
import type * as Collections from '@/lib/collections.functions';
import type * as FediProfileFns from '@/lib/fedi-profile.functions';
import type * as FedizenProfileFns from '@/lib/fedizen-profile.functions';
import type * as Fedizen from '@/lib/fedizen.functions';
import type * as Groups from '@/lib/groups.functions';
import type * as Intelligence from '@/lib/intelligence.functions';
import type * as Push from '@/lib/push.functions';
import type * as TagFeed from '@/lib/tag-feed.functions';
import type * as Spotlight from '@/lib/spotlight.functions';
import type * as Translation from '@/lib/translation.functions';
import type * as Voices from '@/lib/voices.functions';
import type { Impl } from './types';
import type { IntelligenceStatus } from '@/lib/intelligence.functions';
import type { FedizenNoticeGroup, FedizenPerson, FedizenPost } from '@/lib/fedizen-feed';
import type { Group, GroupPost, Membership } from '@/lib/groups';
import { joinModeOf } from '@/lib/groups';
import type { Collection } from '@/lib/collections';
import type { FediProfile } from '@/lib/fedi-profile';
import type { SpotlightItem, BonfireArticle } from '@/lib/spotlight';
import { filterKind, normalizeFilterText, type ContentFilter } from '@/lib/content-filter';
import { podcastVoices, videoVoices, voices as writerVoices } from '@/lib/voices';
import { DEFAULT_LIMITS } from '@/lib/compose-media';
import space from '@/assets/news-space.jpg';
import design from '@/assets/news-design.jpg';
import architecture from '@/assets/news-architecture.jpg';
import travel from '@/assets/news-travel.jpg';
import G from '../data/fedizen-groups.json';
import { PEOPLE, actorOf, personByAcct, profileUrl, type PersonKey } from '../data/people';
import { LAB_FEDIZEN_HANDLE, LAB_USER } from '../data/me';
import { ALL_POSTS, FOR_YOU, HOME, HOME_OLDER, ISS, ISS_REPLIES, MY_POSTS, NOW, ago, byTag, post } from '../data/posts';
import { labLive } from '../live';

/* ── State this page load ─────────────────────────────────────────────────────────────────────────────── */
const liked = new Set(ALL_POSTS.filter(p => p.liked).map(p => p.id));
const boosted = new Set(ALL_POSTS.filter(p => p.boosted).map(p => p.id));
const saved = new Set(ALL_POSTS.filter(p => p.bookmarked).map(p => p.id));
const posted: FedizenPost[] = [];
const removed = labLive.removed;
const following = new Set<PersonKey>(['orbit', 'studio', 'ana', 'grace', 'sam', 'mika', 'kenji', 'hearth', 'theo', 'mara', 'priya']);
const followedTags = new Set(['space', 'astronomy', 'design', 'astrophotography']);
const muted: FedizenPerson[] = [];
const blocked: FedizenPerson[] = [{ id: 'acct-blocked', name: 'Crypto Giveaway', handle: '@giveaway@spam.example', avatar: undefined }];
const memberships: Record<string, Membership> = Object.fromEntries((G.joined as string[]).map(id => [id, 'member' as Membership]));
const live = labLive.replies;

const person = (k: PersonKey): FedizenPerson => ({ id: `acct-${k}`, name: PEOPLE[k].name, handle: `@${PEOPLE[k].acct}`, avatar: PEOPLE[k].avatar });
const fedi = (k: PersonKey) => ({ name: PEOPLE[k].name, avatar: PEOPLE[k].avatar, acct: PEOPLE[k].acct, actor: actorOf(k) });

/** A post as the reader sees it now (their likes, boosts and saves applied). */
function seen(p: FedizenPost): FedizenPost {
  const id = p.statusId ?? p.id;
  const base = p.counts ?? { replies: 0, boosts: 0, likes: 0 };
  const wasLiked = !!p.liked, wasBoosted = !!p.boosted;
  return {
    ...p,
    liked: liked.has(id), boosted: boosted.has(id), bookmarked: saved.has(id),
    counts: { ...base, likes: base.likes + (liked.has(id) ? 1 : 0) - (wasLiked ? 1 : 0), boosts: base.boosts + (boosted.has(id) ? 1 : 0) - (wasBoosted ? 1 : 0) },
  };
}
const shown = (list: FedizenPost[]) => list.filter(p => !removed.has(p.statusId ?? p.id)).map(seen);
const find = (id: string) => [...posted, ...live, ...ALL_POSTS].find(p => (p.statusId ?? p.id) === id || p.id === id);

/* ── Conversations (getFedizenThread): the ISS conversation, and any post's own replies ─────────────────── */
function thread(statusId: string) {
  const all = [ISS, ...ISS_REPLIES, ...live, ...posted, ...ALL_POSTS].filter((p, i, a) => a.findIndex(q => q.id === p.id) === i && !removed.has(p.id));
  const root = all.find(p => p.id === statusId || p.statusId === statusId);
  if (!root) return { post: null, ancestors: [], descendants: [], error: 'not-found' as const };
  const ancestors: FedizenPost[] = [];
  let up = root.replyTo?.statusId;
  while (up) { const a = all.find(p => p.id === up); if (!a) break; ancestors.unshift(a); up = a.replyTo?.statusId; }
  const descendants: FedizenPost[] = [];
  // A deleted reply is left out, as Fedizen leaves it out; its own replies still come back.
  const everything = [ISS, ...ISS_REPLIES, ...live, ...posted, ...ALL_POSTS];
  const walk = (id: string) => everything.filter((p, i, a) => p.replyTo?.statusId === id && a.findIndex(q => q.id === p.id) === i)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')).forEach(c => { if (!removed.has(c.id)) descendants.push(c); walk(c.id); });
  walk(root.id);
  return { post: seen(root), ancestors: ancestors.map(seen), descendants: descendants.map(seen) };
}

/* ── Activity ─────────────────────────────────────────────────────────────────────────────────────────── */
// In Fedizen's shape after fromGroupedNotifications: ids rise with time (newer is larger), as Bonfire's ULIDs do.
const nid = (n: number) => `01LAB${String(n).padStart(6, '0')}`;
const fediId = (k: PersonKey) => ({ ...fedi(k), id: `acct-${k}` });
const { boostedBy: _b, booster: _o, ...QUOTED } = HOME.find(p => p.quote)! as FedizenPost & { booster?: unknown };
const PRIYA = ISS_REPLIES.find(p => p.paragraphs[0].startsWith('Have fun'))!;
const POLL = HOME.find(x => x.pollState)!;
const brief = (p: FedizenPost) => ({ id: p.statusId ?? p.id, text: p.paragraphs[0], ...(p.image ? { image: p.image } : {}) });
const NOTICES: FedizenNoticeGroup[] = [
  { key: 'g1', type: 'mention', count: 1, date: ago(3), people: [fediId('ana')], verb: 'mentioned you', post: brief(HOME[0]), status: HOME[0], latestId: nid(20) },
  { key: 'g2', type: 'favourite', count: 14, date: ago(20), people: [fediId('mara'), fediId('theo'), fediId('grace'), fediId('sam')], verb: 'liked your post', post: brief(MY_POSTS[0]), latestId: nid(19) },
  { key: 'g3', type: 'reply', count: 1, date: ago(39), people: [fediId('priya')], verb: 'replied to you', post: brief(PRIYA), status: PRIYA, latestId: nid(18) },
  { key: 'g8', type: 'follow', count: 1, date: ago(55), people: [fediId('lea')], verb: 'followed you', latestId: nid(17) },
  { key: 'g9', type: 'favourite', count: 1, date: ago(70), people: [fediId('kenji')], verb: 'liked your post', post: brief(MY_POSTS[1]), latestId: nid(16) },
  { key: 'g4', type: 'reblog', count: 6, date: ago(90), people: [fediId('hearth'), fediId('mara')], verb: 'boosted your post', post: brief(MY_POSTS[0]), latestId: nid(15) },
  { key: 'g10', type: 'favourite', count: 1, date: ago(120), people: [fediId('kenji')], verb: 'liked your post', post: brief(MY_POSTS[2]), latestId: nid(14) },
  { key: 'g11', type: 'quote', count: 1, date: ago(150), people: [fediId('theo')], verb: 'quoted your post', post: brief(QUOTED), status: QUOTED, latestId: nid(13) },
  { key: 'g5', type: 'follow', count: 3, date: ago(180), people: [fediId('jonas'), fediId('tomas'), fediId('grace')], verb: 'followed you', latestId: nid(12) },
  { key: 'g6', type: 'poll', count: 1, date: ago(600), people: [fediId('sam')], verb: 'poll ended', post: brief(POLL), latestId: nid(11) },
  { key: 'g12', type: 'favourite', count: 2, date: ago(900), people: [fediId('studio'), fediId('orbit')], verb: 'liked your post', gone: true, latestId: nid(10) },
  { key: 'g7', type: 'added_to_collection', count: 1, date: ago(1440), people: [fediId('mara')], verb: 'added you to a collection', latestId: nid(9) },
];
/** Read up to here: the newest few are unread when the Lab opens. */
let notificationMarker: string | null = nid(16);

/* ── Groups: Fedizen's real public directory, captured from fedizen.net (see data/fedizen-groups.json) ─────── */
type Captured = { id: string; name: string; user: string | null; members: number; dims: { membership: string; visibility: string; participation: string }; summary: string[] };
const icons = G.icons as Record<string, string>;
function asGroup(g: Captured): Group {
  const [username, host] = (g.user ?? '').split('@');
  return {
    id: g.id, name: g.name, type: 'group', username: username || undefined, host: host || 'fedizen.net',
    url: `https://fedizen.net/@${g.user ?? g.name.replace(/\W+/g, '_')}`, summary: g.summary, avatar: icons[g.id],
    members: g.members, joinMode: joinModeOf(g.dims.membership), announcements: g.dims.participation === 'moderators',
    membersOnlyContent: /:preview$|^members/.test(g.dims.visibility), federated: g.dims.visibility === 'global', archived: false,
  };
}
const GROUPS = (G.groups as Captured[]).map(asGroup);
const TOPICS: Group[] = (G.topics as { id: string; name: string; parent: string; user: string | null }[]).map(t => ({
  id: t.id, name: t.name, type: 'topic', parentId: t.parent, host: (t.user ?? '').split('@')[1] || 'fedizen.net', username: (t.user ?? '').split('@')[0] || undefined,
  url: `https://fedizen.net/@${t.user ?? t.name}`, summary: [], joinMode: 'open', announcements: false, membersOnlyContent: false, federated: true, archived: false,
}));
const GROUP_POSTS: GroupPost[] = (G.posts as { group: string; author: string; user: string; date: string; title?: string; text?: string }[]).map((p, i) => ({
  id: `gp-${i}`, objectId: `01LABGP${String(i).padStart(4, '0')}`, group: p.group, groups: [p.group], date: p.date,
  paragraphs: [p.title, p.text].filter((x): x is string => !!x), url: `https://fedizen.net/post/gp-${i}`,
  author: p.author.split('@')[0], handle: `@${p.user}`,
}));

/* ── Profiles ─────────────────────────────────────────────────────────────────────────────────────────── */
function profileOf(acct?: string, actor?: string): FediProfile | null {
  const key = (Object.keys(PEOPLE) as PersonKey[]).find(k => PEOPLE[k].acct === acct?.replace(/^@/, '') || actorOf(k) === actor);
  if (!key) return null;
  const x = PEOPLE[key];
  const theirs = ALL_POSTS.filter(p => p.acct === x.acct && !p.replyTo).slice(0, 12);
  return {
    actor: actorOf(key), acct: `@${x.acct}`, acctVerified: true, url: profileUrl(key), host: x.acct.split('@')[1], name: x.name, avatar: x.avatar,
    header: key === 'orbit' ? space : key === 'studio' ? design : key === 'hearth' ? travel : undefined,
    bio: x.bio, fields: x.fields ?? [], joined: x.joined, followers: x.followers, following: x.following, postCount: x.posts,
    kind: x.kind ?? 'person', locked: !!x.locked,
    posts: theirs.map(p => ({ id: p.id, url: p.url, date: p.date, paragraphs: p.paragraphs, ...(p.image ? { image: p.image } : {}) })) as FediProfile['posts'],
  };
}

/* ── Collections (Atlas-made, kept on Atlas's server in the app) ──────────────────────────────────────── */
const collectionsList: Collection[] = [{
  id: '6f1d8a8e-3b51-4f7a-9a0e-0000000c0001', source: 'atlas', name: 'Space people', description: 'Patient, generous people who explain the sky.', tag: 'space',
  sensitive: false, discoverable: true, curator: { name: 'Damon', acct: `@${LAB_FEDIZEN_HANDLE}` },
  items: (['orbit', 'priya', 'kenji', 'ana'] as PersonKey[]).map(k => ({ name: PEOPLE[k].name, acct: `@${PEOPLE[k].acct}`, avatar: PEOPLE[k].avatar, url: profileUrl(k), actorUri: actorOf(k) })) as Collection['items'],
  itemCount: 4, createdAt: ago(20000), updatedAt: ago(300),
}];

/* ── Discover ─────────────────────────────────────────────────────────────────────────────────────────── */
const SPOTLIGHT: SpotlightItem[] = [
  { id: 's1', source: 'Mastodon', title: 'How amateur astronomers found a new comet', description: 'A retired teacher, a backyard telescope, and the open data that made the discovery possible.', url: 'https://example.org/comet', image: space, provider: 'Sky Notes', author: 'Priya Nair', shares: 412, published: ago(600), authorAccount: { name: PEOPLE.priya.name, acct: `@${PEOPLE.priya.acct}`, url: profileUrl('priya'), avatar: PEOPLE.priya.avatar } as SpotlightItem['authorAccount'] },
  { id: 's2', source: 'Bonfire', title: 'Repair cafés are quietly winning', description: 'From Saint-Étienne to Sapporo, volunteers keep things running longer.', url: 'https://example.org/repair', image: design, provider: 'The Material Studio', shares: 268, published: ago(1400) },
  { id: 's3', source: 'Mastodon', title: 'The city as a shared living room', description: 'Courtyards, benches and the architecture of meeting people.', url: 'https://example.org/courtyards', image: architecture, provider: 'A Softer Form', shares: 190, published: ago(2000) },
  { id: 's4', source: 'Mastodon', title: 'Slow travel by night train', description: 'Seven routes across Europe, and what you see when you don’t fly.', url: 'https://example.org/trains', image: travel, provider: 'Elsewhere Journal', shares: 154, published: ago(2600) },
];
const ARTICLES: BonfireArticle[] = [
  { id: 'a1', title: 'Welcoming groups to Fedizen', summary: 'What federated groups can do now, and what comes next.', paragraphs: ['Groups on Fedizen now federate with Lemmy, PieFed and Mobilizon.'], url: 'https://fedizen.net/post/a1', date: ago(900), author: 'Fedizen Development', handle: '@Fedizen_Development', image: architecture, likes: 42, boosts: 18, replies: 7 },
  { id: 'a2', title: 'A field guide to circles', summary: 'Choosing who sees and replies to each post, without leaving anyone out by accident.', paragraphs: ['Circles group the people you know.'], url: 'https://fedizen.net/post/a2', date: ago(3000), author: 'Mara Quinn', handle: `@${PEOPLE.mara.acct}`, avatar: PEOPLE.mara.avatar, likes: 30, boosts: 11, replies: 4 },
];

const ok = <T extends object>(x: T) => ({ ok: true as const, ...x });
const me = () => ({ id: LAB_USER.id });

export const fedizen: Impl<typeof Fedizen> = {
  getFedizenStatus: () => ({ connected: true, handle: LAB_FEDIZEN_HANDLE, canWrite: true, nativeReadEnabled: false }),
  startFedizenConnect: () => ({ url: null, error: 'This address can’t connect to Fedizen.' as const }),
  disconnectFedizen: () => ({ ok: true as const, revoked: true }),
  getFedizenHome: () => ({ connected: true, canWrite: true, accountHandle: LAB_FEDIZEN_HANDLE, nativeReadEnabled: false, posts: shown([...posted, ...HOME]), next: 'older-1', notices: [] }),
  getFedizenHomePage: (d: { max?: string }) => (d?.max === 'older-1' ? { posts: shown(HOME_OLDER) } : { posts: [] }),
  getFedizenHomeLatest: () => ({ posts: shown([...posted, ...HOME]), next: 'older-1', notices: [] }),
  getGroupedNotifications: (d: { filter?: string; max?: string }) => {
    if (d?.max) return { groups: [] };
    const types = d?.filter === 'replies' ? ['mention', 'reply', 'status', 'quote'] : d?.filter === 'follows' ? ['follow', 'follow_request'] : null;
    return { groups: types ? NOTICES.filter(n => types.includes(n.type)) : NOTICES };
  },
  getNotificationMarker: () => ({ lastRead: notificationMarker }),
  setNotificationMarker: (d: { lastRead: string }) => { notificationMarker = d.lastRead; return { ok: true as const }; },
  followFedizenAccount: (d: { accountId: string; on: boolean }) => {
    const k = d.accountId.replace(/^acct-/, '') as PersonKey;
    if (d.on) following.add(k); else following.delete(k);
    return { ok: true as const, state: d.on ? 'following' as const : 'none' as const };
  },
  getFedizenMessages: () => ({
    connected: true,
    conversations: [
      { id: 'c1', unread: true, people: [{ name: PEOPLE.priya.name, handle: `@${PEOPLE.priya.acct}`, avatar: PEOPLE.priya.avatar }], text: 'Thursday 05:12 — want to try from the hill? I’ll bring tea.', date: ago(12) },
      { id: 'c2', unread: false, people: [{ name: PEOPLE.mara.name, handle: `@${PEOPLE.mara.acct}`, avatar: PEOPLE.mara.avatar }, { name: PEOPLE.theo.name, handle: `@${PEOPLE.theo.acct}`, avatar: PEOPLE.theo.avatar }], text: 'Sent you both the draft for the co-op page.', date: ago(400) },
    ],
  }),
  getFedizenSaved: () => ({ posts: shown(ALL_POSTS.filter((p, i, a) => saved.has(p.statusId ?? p.id) && a.findIndex(q => q.id === p.id) === i)) }),
  setFedizenSaved: (d: { statusId: string; on: boolean }) => { if (d.on) saved.add(d.statusId); else saved.delete(d.statusId); return ok({ saved: d.on }); },
  setFedizenReaction: (d: { statusId: string; kind: 'like' | 'boost'; on: boolean }) => {
    const set = d.kind === 'boost' ? boosted : liked; if (d.on) set.add(d.statusId); else set.delete(d.statusId);
    const p = find(d.statusId); return ok({ on: d.on, ...(p ? { count: seen(p).counts?.[d.kind === 'boost' ? 'boosts' : 'likes'] } : {}) });
  },
  searchFedizenPeople: (d: { q?: string }) => ({ people: (Object.keys(PEOPLE) as PersonKey[]).filter(k => `${PEOPLE[k].name} ${PEOPLE[k].acct}`.toLowerCase().includes((d?.q ?? '').toLowerCase().replace(/^@/, ''))).slice(0, 8).map(person) }),
  replyOnFedizen: (d: { statusId: string; text: string; cw?: string; visibility?: FedizenPost['visibility'] }) => {
    const r = post(d.text, { by: 'me', min: 0, replyTo: { statusId: d.statusId }, visibility: d.visibility ?? 'public', ...(d.cw ? { cw: d.cw } : {}) }); posted.unshift(r); return ok({ url: r.url });
  },
  getFedizenCircles: () => ({ circles: circles.map(c => ({ id: c.id, title: c.title, ...(c.summary ? { summary: c.summary } : {}) })), canWrite: true, describable: true }),
  // Sample: Ana and Priya follow you back, so only they would get a circle post.
  getFedizenCircleMembers: (d: { id: string }) => {
    const people = circles.find(c => c.id === d.id)?.members ?? [];
    return { people, followsYou: people.filter(p => FOLLOWS_YOU.has(p.handle.replace(/^@/, ''))).map(p => p.id) };
  },
  saveFedizenCircle: (d: { id?: string; title: string; summary: string }) => {
    const c = d.id ? circles.find(x => x.id === d.id) : undefined;
    if (d.id && !c) return { ok: false as const, error: 'unavailable' as const };
    const saved = c ?? { id: `01LABCIRCLE${String(circles.length + 1).padStart(4, '0')}`, title: d.title, members: [] };
    saved.title = d.title; saved.summary = d.summary || undefined;
    if (!c) circles.push(saved);
    return ok({ circle: { id: saved.id, title: saved.title, ...(saved.summary ? { summary: saved.summary } : {}) } });
  },
  getFedizenAudiences: () => ({ audiences: [{ id: '01LABAUDIENCE0001', label: 'Hill walkers', description: 'People from the Saturday walks' }] }),
  changeFedizenCircle: (d: { action: 'create' | 'rename' | 'delete'; id?: string; title?: string }) => {
    if (d.action === 'delete' && d.id) { const i = circles.findIndex(c => c.id === d.id); if (i >= 0) circles.splice(i, 1); return ok({}); }
    if (d.action === 'rename' && d.id) { const c = circles.find(x => x.id === d.id); if (c && d.title) c.title = d.title; return ok({ circle: c ? { id: c.id, title: c.title } : undefined }); }
    const c = { id: `01LABCIRCLE${String(circles.length + 1).padStart(4, '0')}`, title: d.title ?? 'New circle', members: [] }; circles.push(c); return ok({ circle: { id: c.id, title: c.title } });
  },
  changeFedizenCircleMember: (d: { id: string; add?: string; addId?: string; remove?: string }) => {
    const c = circles.find(x => x.id === d.id); if (!c) return { ok: false as const, error: 'not-found' as const };
    if (d.remove) { c.members = c.members.filter(m => m.id !== d.remove); return ok({}); }
    if (d.addId) { const k = (Object.keys(PEOPLE) as PersonKey[]).find(y => person(y).id === d.addId); if (!k) return { ok: false as const, error: 'not-found' as const }; if (!c.members.some(m => m.id === d.addId)) c.members.push(person(k)); return ok({}); }
    const x = d.add ? personByAcct(d.add) : undefined; const k = x ? (Object.keys(PEOPLE) as PersonKey[]).find(y => PEOPLE[y] === x) : undefined;
    if (!k) return { ok: false as const, error: 'not-found' as const };
    const m = person(k); c.members.push(m); return ok({ person: m });
  },
  getFedizenBlocks: () => ({ people: blocked, canWrite: true }),
  changeFedizenBlock: (d: { block?: string; unblock?: string }) => {
    if (d.unblock) { const i = blocked.findIndex(b => b.id === d.unblock); if (i >= 0) blocked.splice(i, 1); return ok({}); }
    const x = d.block ? personByAcct(d.block) : undefined; const k = x ? (Object.keys(PEOPLE) as PersonKey[]).find(y => PEOPLE[y] === x) : undefined;
    if (!k) return { ok: false as const, error: 'not-found' as const }; const b = person(k); blocked.push(b); return ok({ person: b });
  },
  getForYou: () => ({ posts: FOR_YOU.map(p => ({ ...seen(p), reasons: p.reasons })), tags: [...followedTags], groups: Object.keys(memberships), missing: [] }),
  getFollowedTags: () => ({ tags: [...followedTags], names: [...followedTags], full: true }),
  setTagFollow: (d: { tag: string; on: boolean }) => { if (d.on) followedTags.add(d.tag.toLowerCase()); else followedTags.delete(d.tag.toLowerCase()); return ok({ following: d.on }); },
  getFedizenTagFeed: (d: { tag: string }) => ({ posts: shown(byTag(d.tag)) }),
  getCircleFeed: (d: { id: string }) => {
    const c = circles.find(x => x.id === d.id); if (!c) return { posts: [], error: 'not-found' as const };
    const accts = new Set(c.members.map(m => m.handle.replace(/^@/, '')));
    return { posts: shown(HOME.filter(p => p.acct && accts.has(p.acct))) };
  },
  getFedizenComposeLimits: () => DEFAULT_LIMITS,
  uploadFedizenMedia: () => ({ ok: false as const, error: 'unavailable' as const }),
  postOnFedizen: (d: { text: string; visibility?: FedizenPost['visibility']; cw?: string }) => { const p = post(d.text, { by: 'me', min: 0, visibility: d.visibility ?? 'public', ...(d.cw ? { cw: d.cw } : {}) }); posted.unshift(p); return ok({ url: p.url, id: p.id }); },
  // A sample circle post: kept in this page as a followers-only card; the sample circle 'reads' it at once.
  createCirclePostOnFedizen: (d: { text: string; cw?: string }) => { const p = post(d.text, { by: 'me', min: 0, visibility: 'private', ...(d.cw ? { cw: d.cw } : {}) }); posted.unshift(p); return ok({ url: p.url, id: p.id, shared: 'confirmed' as const }); },
  createPostOnFedizen: (d: { text: string; visibility?: FedizenPost['visibility']; cw?: string }) => { const p = post(d.text, { by: 'me', min: 0, visibility: d.visibility ?? 'public', ...(d.cw ? { cw: d.cw } : {}) }); posted.unshift(p); return ok({ url: p.url, id: p.id }); },
  getGifs: () => ({ ok: false as const, error: 'unavailable' as never }),
  getGifsEnabled: () => ({ enabled: false }),
  attachGifOnFedizen: () => ({ ok: false as const, error: 'unavailable' as const }),
  deleteFedizenPost: (d: { statusId: string }) => { removed.add(d.statusId); return ok({}); },
  getFedizenPostSource: (d: { statusId: string }) => { const p = find(d.statusId); return p ? ok({ text: p.paragraphs.join('\n\n'), cw: p.cw ?? '' }) : { ok: false as const, error: 'not-found' as const }; },
  editFedizenPost: (d: { statusId: string; text: string; cw?: string }) => {
    const p = find(d.statusId); if (!p) return { ok: false as const, error: 'not-found' as const };
    p.paragraphs = d.text.split(/\n{2,}/); p.cw = d.cw || undefined; p.editedAt = new Date().toISOString(); return ok({});
  },
  voteOnFedizenPoll: (d: { pollId: string; choices: number[] }) => {
    const p = ALL_POSTS.find(x => x.pollState?.id === d.pollId); if (!p?.pollState) return { ok: false as const, error: 'closed' as const };
    d.choices.forEach(i => { const o = p.pollState!.options[i]; if (o) o.votes = (o.votes ?? 0) + 1; });
    p.pollState = { ...p.pollState, voted: true, ownVotes: d.choices, votes: (p.pollState.votes ?? 0) + d.choices.length, voters: (p.pollState.voters ?? 0) + 1 };
    return ok({ poll: p.pollState });
  },
  getFedizenThread: (d: { statusId: string }) => thread(d.statusId),
  getFollowRequests: () => ({ people: requests }),
  answerFollowRequest: (d: { accountId: string; accept: boolean }) => { const i = requests.findIndex(r => r.id === d.accountId); if (i >= 0) requests.splice(i, 1); return ok({}); },
  searchFedizenPosts: (d: { q: string }) => { const q = d.q.toLowerCase(); return { posts: shown(ALL_POSTS.filter((p, i, a) => a.findIndex(x => x.id === p.id) === i && (p.paragraphs.join(' ') + ' ' + p.author).toLowerCase().includes(q)).slice(0, 20)) }; },
  muteFedizenAccount: (d: { accountId?: string; acct?: string; on: boolean }) => {
    const x = d.acct ? personByAcct(d.acct) : undefined; const k = x ? (Object.keys(PEOPLE) as PersonKey[]).find(y => PEOPLE[y] === x) : undefined;
    const m = k ? person(k) : { id: d.accountId ?? 'acct', name: d.acct ?? 'Someone', handle: `@${d.acct ?? ''}` };
    if (d.on) muted.push(m); else muted.splice(0, muted.length, ...muted.filter(y => y.id !== m.id)); return ok({});
  },
  getMutedAccounts: () => ({ people: muted }),
  reportOnFedizen: () => ok({}),
  getWhoReacted: () => ({ people: (['mara', 'theo', 'grace', 'sam'] as PersonKey[]).map(k => ({ ...person(k), acct: PEOPLE[k].acct, actor: actorOf(k) })) }),
  getLikedPosts: () => ({ posts: shown(ALL_POSTS.filter((p, i, a) => liked.has(p.statusId ?? p.id) && a.findIndex(q => q.id === p.id) === i)) }),
  getRecentHashtags: () => ({ tags: ['atlas', 'fediverse', 'space'] }),
  suggestHashtags: () => ({ tags: ['astronomy', 'space', 'fediverse'] }),
};
const circles: { id: string; title: string; summary?: string; members: FedizenPerson[] }[] = [
  { id: '01LABCIRCLE0001', title: 'Astronomy club', summary: 'Dark-sky nights and the hill on Thursdays', members: (['ana', 'priya', 'grace', 'jonas'] as PersonKey[]).map(person) },
  { id: '01LABCIRCLE0002', title: 'Family', members: [] },
];
const requests: (FedizenPerson & { acct?: string; actor?: string })[] = [{ ...person('kenji'), acct: PEOPLE.kenji.acct, actor: actorOf('kenji') }];

export const bonfire: Impl<typeof Bonfire> = {
  getRecentArticles: () => ({ articles: ARTICLES }),
  getFedizenPublic: () => ({ posts: shown(HOME.slice(0, 8)) }),
};
export const bonfirePrivate: Impl<typeof BonfirePrivate> = {
  getNativeBonfireSnapshot: () => ({ status: 'disabled' as const, identity: null as never, restAccountHandle: LAB_FEDIZEN_HANDLE, posts: [], notices: [], homeEndCursor: null, homeHasNextPage: false, notificationEndCursor: null, notificationHasNextPage: false }),
  getNativeBonfireHomeContinuation: () => ({ status: 'disabled' as const, identity: null as never, restAccountHandle: LAB_FEDIZEN_HANDLE, posts: [], notices: [], homeEndCursor: null, homeHasNextPage: false, notificationEndCursor: null, notificationHasNextPage: false }),
  getNativeHomeDetails: () => ({ status: 'disabled' as const, posts: {} }),
  getNativeBonfireHomeLatest: () => ({ status: 'disabled' as const, posts: [] }),
};
// Sample (invented) Fedizen profile for Edit profile; saving changes it for this page load only.
let labProfile = { name: 'Atlas Lab', bio: 'A sample profile in the Device Lab. #openweb', website: 'example.org', location: 'Sample City' };
export const fedizenProfile: Impl<typeof FedizenProfileFns> = {
  getMyFedizenProfile: () => ({ profile: labProfile, canWrite: true }),
  saveMyFedizenProfile: (d: { profile: typeof labProfile }) => { labProfile = { ...d.profile }; return { ok: true as const, profile: labProfile }; },
  // The picked picture stays in this page (an object URL); nothing is uploaded anywhere.
  saveMyFedizenProfileImage: (d: FormData) => {
    const file = d.get('file');
    return file instanceof Blob ? { ok: true as const, url: URL.createObjectURL(file) } : { ok: false as const, error: 'unsupported' as const };
  },
};
export const groups: Impl<typeof Groups> = {
  getGroups: () => ({ groups: [...GROUPS, ...TOPICS], next: null }),
  getLatestInGroups: () => ({ latest: GROUP_POSTS }),
  getGroup: (d: { id: string }) => {
    const g = [...GROUPS, ...TOPICS].find(x => x.id === d.id);
    if (!g) return { group: null, error: 'not-found' as const };
    return { group: g, topics: TOPICS.filter(t => t.parentId === g.id), posts: GROUP_POSTS.filter(p => p.group === g.id) };
  },
  getMemberships: (d: { ids: string[] }) => ({ ok: true as const, memberships: Object.fromEntries(d.ids.map(id => [id, memberships[id] ?? 'none'])) as Record<string, Membership> }),
  setGroupMembership: (d: { id: string; on: boolean }) => {
    const g = GROUPS.find(x => x.id === d.id);
    const m: Membership = !d.on ? 'none' : g?.joinMode === 'request' ? 'requested' : 'member';
    memberships[d.id] = m; return { ok: true as const, membership: m };
  },
};
export const collections: Impl<typeof Collections> = {
  getMyCollections: () => ({ collections: collectionsList }),
  getCollection: (d: { id?: string }) => collectionsList.find(c => c.id === d.id) ?? null,
  getAccountCollections: () => [],
  createCollection: (d: { input: { name: string; description?: string; tag?: string } }) => {
    const c: Collection = { id: crypto.randomUUID(), source: 'atlas', name: d.input.name, description: d.input.description, tag: d.input.tag, sensitive: false, discoverable: true, curator: { name: 'Damon', acct: `@${LAB_FEDIZEN_HANDLE}` }, items: [], itemCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    collectionsList.push(c); return { id: c.id, error: null };
  },
  updateCollection: (d: { id: string; input: { name: string; description?: string } }) => { const c = collectionsList.find(x => x.id === d.id); if (c) Object.assign(c, { name: d.input.name, description: d.input.description }); return { ok: true, collection: c }; },
  deleteCollection: (d: { id: string }) => { const i = collectionsList.findIndex(x => x.id === d.id); if (i >= 0) collectionsList.splice(i, 1); return { ok: true }; },
  addToCollection: (d: { id: string; handle: string }) => {
    const c = collectionsList.find(x => x.id === d.id); const x = personByAcct(d.handle);
    if (!c || !x) return { ok: false, message: 'No one with that handle in the sample data.' };
    const k = (Object.keys(PEOPLE) as PersonKey[]).find(y => PEOPLE[y] === x)!;
    c.items.push({ name: x.name, acct: `@${x.acct}`, avatar: x.avatar, url: profileUrl(k), actorUri: actorOf(k) } as Collection['items'][number]); c.itemCount++;
    return { ok: true };
  },
  removeFromCollection: (d: { id: string; actorUri: string }) => { const c = collectionsList.find(x => x.id === d.id); if (c) { c.items = c.items.filter(i => (i as { actorUri?: string }).actorUri !== d.actorUri); c.itemCount = c.items.length; } return { ok: true }; },
};
/** Sample people who follow you back (accts), for circle reach. */
const FOLLOWS_YOU = new Set([PEOPLE.ana.acct, PEOPLE.priya.acct]);

export const fediProfile: Impl<typeof FediProfileFns> = {
  getFediCircles: (d: { acct?: string }) => {
    const x = d.acct ? personByAcct(d.acct) : undefined; const k = x ? (Object.keys(PEOPLE) as PersonKey[]).find(y => PEOPLE[y] === x) : undefined;
    if (!k) return { ids: [], error: 'not-found' as const };
    const id = person(k).id;
    return { accountId: id, ids: circles.filter(c => c.members.some(m => m.id === id)).map(c => c.id) };
  },
  getFediProfile: (d: { acct?: string; actor?: string }) => ({ profile: profileOf(d?.acct, d?.actor) }),
  getActorAvatar: (d: { actor: string }) => ({ avatar: profileOf(undefined, d?.actor)?.avatar ?? null }),
  getFediFollow: (d: { acct?: string; actor?: string }) => {
    const x = d.acct ? personByAcct(d.acct) : undefined; const k = x ? (Object.keys(PEOPLE) as PersonKey[]).find(y => PEOPLE[y] === x) : undefined;
    return { state: (k && following.has(k) ? 'following' : 'none') as 'following' | 'none', canWrite: true };
  },
  setFediFollow: (d: { acct?: string; on: boolean }) => {
    const x = d.acct ? personByAcct(d.acct) : undefined; const k = x ? (Object.keys(PEOPLE) as PersonKey[]).find(y => PEOPLE[y] === x) : undefined;
    if (k) { if (d.on) following.add(k); else following.delete(k); }
    return { ok: true as const, state: (d.on ? (x?.locked ? 'requested' : 'following') : 'none') as 'following' | 'requested' | 'none' };
  },
};

const filters: ContentFilter[] = [];
// Invented sample keys (hints only; there are no keys): two companies, one with a name, so Settings → Intelligence
// shows the main key, backups and background filtering. Intelligence stays off, so nothing calls a provider.
const SAMPLE_KEYS: IntelligenceStatus['keys'] = [
  { id: '00000000-0000-4000-8000-0000000000a1', provider: 'anthropic', label: 'Work', hint: '…a1b2', models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'], model: 'claude-haiku-5-5' },
  { id: '00000000-0000-4000-8000-0000000000a2', provider: 'openai', label: null, hint: '…c3d4', models: ['gpt-6-mini', 'gpt-6'], model: 'gpt-6-mini' },
];
const aiStatus: IntelligenceStatus = {
  available: true, serverKeys: true, enabled: false, provider: 'anthropic', model: 'claude-haiku-5-5', mainKey: SAMPLE_KEYS[0].id,
  background: null, fallback: true, embeddingProvider: 'openai', deepMatching: false, keys: SAMPLE_KEYS,
};
const pickKey = (c: { key: string; model?: string }) => { const k = SAMPLE_KEYS.find(x => x.id === c.key); return k ? { k, model: c.model && k.models.includes(c.model) ? c.model : k.model ?? k.models[0] } : null; };
export const intelligence: Impl<typeof Intelligence> = {
  getIntelligence: () => aiStatus,
  saveAiKey: () => ({ error: 'not-configured' as const }),
  removeAiKey: () => aiStatus,
  updateAiKey: (d: { keyId: string; label?: string | null }) => { const k = SAMPLE_KEYS.find(x => x.id === d.keyId); if (k && d.label !== undefined) k.label = d.label; return aiStatus; },
  updateIntelligence: (d: { deepMatching?: boolean; fallback?: boolean; enabled?: boolean; main?: { key: string; model?: string }; background?: { key: string; model?: string } | null }) => {
    if (d.deepMatching != null) aiStatus.deepMatching = d.deepMatching;
    if (d.fallback != null) aiStatus.fallback = d.fallback;
    const m = d.main && pickKey(d.main);
    if (m) Object.assign(aiStatus, { mainKey: m.k.id, provider: m.k.provider, model: m.model });
    if (d.background === null) aiStatus.background = null;
    const b = d.background && pickKey(d.background);
    if (b) aiStatus.background = { key: b.k.id, provider: b.k.provider, model: b.model };
    return aiStatus;
  },
  listContentFilters: () => ({ filters }),
  // In the real functions' shapes: words plus options in; the whole list back.
  addContentFilters: (d: { texts: string[]; action: ContentFilter['action']; places: ContentFilter['places']; expiresAt: string | null; exceptFollowing: boolean }) => {
    for (const raw of d.texts) {
      const text = normalizeFilterText(raw);
      if (!text || filters.some(f => f.text.toLowerCase() === text.toLowerCase())) continue;
      filters.push({ id: crypto.randomUUID(), text, kind: filterKind(text), action: d.action, semantic: true, expansions: [], places: d.places, expiresAt: d.expiresAt, exceptFollowing: d.exceptFollowing });
    }
    return { filters };
  },
  updateContentFilter: (d: { id: string } & Partial<ContentFilter>) => { const { id, ...patch } = d; const f = filters.find(x => x.id === id); if (f) Object.assign(f, patch); return { filters }; },
  deleteContentFilter: (d: { id: string }) => { const i = filters.findIndex(x => x.id === d.id); if (i >= 0) filters.splice(i, 1); return { filters }; },
  expandContentFilter: () => ({ error: 'not-ready' as const }),
  judgeFilteredPosts: () => ({ error: 'not-ready' as const }),
  suggestContentFilters: () => ({ error: 'not-ready' as const }),
  describePostForFilter: () => ({ error: 'not-ready' as const }),
  embedTextsFor: () => ({ error: 'not-ready' as const }),
  searchWordingsFor: () => ({ error: 'not-ready' as const }),
  // The app asks by Fedizen account id (acct-<person> here), as relationships does.
  followingAmong: (d: { ids: string[] }) => ({ following: Object.fromEntries((d?.ids ?? []).map(id => [id, following.has(id.replace(/^acct-/, '') as PersonKey)])) }),
  altTextForImage: () => ({ error: 'not-ready' as const }),
};
export const push: Impl<typeof Push> = {
  getPushConfig: () => ({ configured: false as const, publicKey: null, problem: 'missing' as const }),
  // Notifications need the browser's push service, which an artifact page can't use (lib/push).
  getPushState: () => ({ thisDevice: false, alerts: { mention: true, status: false, reblog: true, follow: true, follow_request: true, favourite: true, poll: true, update: false, quote: true }, policy: 'all' as const }),
  enablePush: () => ({ ok: false as const, error: 'Notifications aren’t part of the Device Lab.' }),
  disablePush: () => ({ ok: true }),
  setPushChoice: () => ({ ok: true }),
};
// Public posts for a hashtag, as mastodon.social would answer a signed-out reader (invented sample).
export const tagFeed: Impl<typeof TagFeed> = {
  getTagFeed: (d: { tag: string }) => HOME.slice(0, 3).map((p, i) => ({
    id: `pub-${i}`, url: `https://mastodon.example/@sample/${i}`, createdAt: ago(60 * (i + 1)),
    text: [`${p.paragraphs[0]} #${d.tag.replace(/^#/, '')}`],
    author: { name: p.author, acct: (p.acct ?? p.handle).replace(/^@/, ''), avatar: p.avatar ?? '', url: `https://mastodon.example/@sample${i}` },
    replies: i, boosts: 2 * i, favourites: 3 + i,
  })),
};

export const spotlight: Impl<typeof Spotlight> = { getSpotlight: () => ({ items: SPOTLIGHT, bonfireCount: 1 }) };
export const translation: Impl<typeof Translation> = {
  getTranslationKeys: () => ({ serverKeys: true, deepl: null }),
  saveDeeplKey: () => ({ error: 'not-configured' as const }),
  removeDeeplKey: () => ({ ok: true as const }),
  translateWithDeepl: () => ({ error: 'no-key' as const }),
  translateWithAi: () => ({ error: 'no-key' as const }),
};
export const voices: Impl<typeof Voices> = {
  getVoices: () => ({ voices: [...writerVoices.map(v => ({ ...v, category: 'writer' as const })), ...podcastVoices, ...videoVoices], sources: { fedidb: false, castopodIndex: false } }),
  getVoiceAvatars: () => ({} as Record<string, string | null>),
};

void NOW; void me;
