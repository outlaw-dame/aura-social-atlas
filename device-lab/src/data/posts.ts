/**
 * Sample posts for the Device Lab: Home, For You, tags, saved and liked posts, profiles, and one long conversation.
 * Written for the Lab; each is shaped as Fedizen's API reaches Atlas (FedizenPost, lib/fedizen-feed.ts), with the
 * features the app draws: media with sizes, a poll, a content warning, a boost, a quote, a link card, other
 * languages for translation, mentions and hashtags. Times are relative to when the page loads.
 */
import type { FedizenPost } from '@/lib/fedizen-feed';
import space from '@/assets/news-space.jpg';
import design from '@/assets/news-design.jpg';
import architecture from '@/assets/news-architecture.jpg';
import travel from '@/assets/news-travel.jpg';
import { PEOPLE, actorOf, profileUrl, type PersonKey } from './people';
import { LAB_FEDIZEN_HANDLE, labProfile } from './me';
import { AVATAR_PRESETS } from '@/lib/atlas-avatars';

export const NOW = Date.now();
export const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
let seq = 0;
const nextId = () => `01LAB${String(++seq).padStart(6, '0')}`;

type Opt = Partial<FedizenPost> & { by?: PersonKey | 'me'; min?: number };
export function post(text: string | string[], o: Opt = {}): FedizenPost {
  const id = o.id ?? nextId();
  const by = o.by ?? 'orbit';
  const who = by === 'me'
    ? { name: labProfile.display_name ?? 'Damon', acct: LAB_FEDIZEN_HANDLE, avatar: AVATAR_PRESETS[1].src, actor: 'https://fedizen.net/pub/actors/damon', url: 'https://fedizen.net/@damon' }
    : { name: PEOPLE[by].name, acct: PEOPLE[by].acct, avatar: PEOPLE[by].avatar, actor: actorOf(by), url: profileUrl(by) };
  const paragraphs = Array.isArray(text) ? text : [text];
  const tags = [...paragraphs.join(' ').matchAll(/#([\p{L}\p{N}_]+)/gu)].map(m => m[1].toLowerCase());
  const { by: _b, min, ...rest } = o;
  return {
    id, statusId: id, author: who.name, handle: `@${who.acct}`, acct: who.acct, actor: who.actor, avatar: who.avatar,
    paragraphs, url: `${who.url}/${id}`, date: ago(min ?? 30), visibility: 'public', language: 'en',
    counts: { replies: 0, boosts: 0, likes: 0 }, authorId: `acct-${by}`,
    ...(tags.length ? { tags } : {}),
    ...rest,
  };
}

const img = (src: string, w = 1600, h = 900) => ({ image: src, imageSize: { w, h } });

/* ── One long conversation (prototype A with Atlas folds; the Lab's "Conversation" button opens it) ─────────── */
export const ISS = post('Tonight’s ISS pass is visible across most of the northern hemisphere around 21:40 local time. Look west-southwest; it climbs to about 70°. Who’s going out? #space', {
  id: '01LABISS000001', by: 'orbit', min: 62, ...img(space), alt: ['A starry sky over a dark landscape'], counts: { replies: 21, boosts: 48, likes: 212 },
});
type Row = [string, string, PersonKey | 'me', number, string, string];
const ROWS: Row[] = [
  ['r1', 'root', 'mika', 58, 'ja', '今夜は札幌も晴れの予報です！望遠鏡を持って出かけます。'],
  ['r1a', 'r1', 'orbit', 55, 'en', 'Lovely. Try a wide-field eyepiece, or just binoculars: it crosses the sky in about four minutes.'],
  ['r1b', 'r1', 'mika', 52, 'ja', 'ありがとうございます、双眼鏡で試してみます。'],
  ['r2', 'root', 'lea', 57, 'fr', 'Ciel couvert à Lyon ce soir, comme d’habitude dès qu’il se passe quelque chose là-haut…'],
  ['r2a', 'r2', 'tomas', 54, 'es', 'Aquí en Valencia también hay nubes. ¿Alguien sabe si habrá otro paso esta semana?'],
  ['r2a1', 'r2a', 'priya', 50, 'en', 'Heavens-Above lists one on Thursday at 05:12 for most of Europe. Lower, but still bright.'],
  ['r2a1a', 'r2a1', 'tomas', 48, 'es', '¡Perfecto, pondré la alarma!'],
  ['r2a1b', 'r2a1', 'lea', 46, 'fr', 'Jeudi à cinq heures du matin… je vais essayer, merci !'],
  ['r2a2', 'r2a', 'jonas', 47, 'de', 'In Hamburg sieht es leider genauso aus.'],
  ['r2b', 'r2', 'sam', 45, 'en', 'Same in Manchester. We should start a club for clouded-out observers.'],
  ['r2b1', 'r2b', 'ana', 41, 'en', 'Half my club is clouded-out observers. Clear Outside and Meteoblue’s astronomy seeing page have saved me a lot of cold evenings: they split the forecast into low, mid and high cloud by the hour, so you can see whether a gap is coming before you drive anywhere.'],
  ['r2b1a', 'r2b1', 'sam', 38, 'en', 'Clear Outside is great, thanks Ana.'],
  ['r2b1a1', 'r2b1a', 'ana', 36, 'en', 'The hourly low/mid/high split is what sold me.'],
  ['r2b1a1a', 'r2b1a1', 'priya', 33, 'en', 'Astrospheric does the same for North America, with seeing and transparency too.'],
  ['r2b2', 'r2b', 'jonas', 35, 'de', 'In unserem Verein haben wir eine Liste mit dunklen Orten rund um Hamburg, ohne viel Lichtverschmutzung. Wenn jemand Interesse hat, teile ich sie gern hier im Thread.'],
  ['r3', 'root', 'me', 40, 'en', 'Going up to the roof with the kids. Will report back!'],
  ['r3a', 'r3', 'priya', 39, 'en', 'Have fun! Binoculars are plenty for the ISS.'],
  ['r4', 'root', 'kenji', 30, 'ja', '撮影するなら、三脚に固定して10秒ほどの露出を何枚も撮り、あとで比較明合成すると光跡がきれいに残ります。'],
  ['r4a', 'r4', 'grace', 26, 'en', 'Saving this. What lens would you use?'],
  ['r5', 'root', 'grace', 22, 'en', 'Why does it look so bright? It isn’t that big.'],
  ['r5a', 'r5', 'orbit', 18, 'en', 'Its solar arrays span about the length of a football field, and they’re still in sunlight after it’s dark where you are.'],
];
const rowId = (k: string) => (k === 'root' ? ISS.id : `01LABISS${k.toUpperCase().padEnd(6, '0')}`);
export const ISS_REPLIES: FedizenPost[] = ROWS.map(([k, parent, by, min, lang, text]) => {
  const kids = ROWS.filter(r => r[1] === k).length;
  return post(text, { id: rowId(k), by, min, language: lang, replyTo: { statusId: rowId(parent) }, counts: { replies: kids, boosts: 0, likes: Math.max(0, 9 - kids * 2) } });
});

/* ── Home ─────────────────────────────────────────────────────────────────────────────────────────────── */
export const HOME: FedizenPost[] = [
  post(['Clear Outside says a two-hour gap opens at 21:10. Bringing the 10×50s up the hill. @priya, are you tracking tonight’s pass? #astronomy'], {
    by: 'ana', min: 4, mentions: [{ acct: PEOPLE.priya.acct, username: 'priya' }], counts: { replies: 2, boosts: 1, likes: 14 },
  }),
  ISS,
  post('今夜の月。薄雲越しでも綺麗でした。#月 #astrophotography', { by: 'mika', min: 75, language: 'ja', ...img(space, 1200, 1200), alt: ['A crescent moon through thin cloud'], counts: { replies: 3, boosts: 12, likes: 96 } }),
  post('We repaired a 1960s lamp this week: new cloth flex, the original brass. The workshop notes are up. #design #repair', {
    by: 'studio', min: 96, counts: { replies: 4, boosts: 9, likes: 57 },
    article: { url: 'https://materialstudio.example/notes/lamp', title: 'A second life for familiar materials', provider: 'The Material Studio', description: 'Workshop notes on repairing, reusing, and designing objects worth keeping.', image: design },
    linkTitle: 'A second life for familiar materials',
  }),
  post('Quick poll for my Year 9s: what should our citizen-science project count next month? #CitizenScience', {
    by: 'sam', min: 130, counts: { replies: 6, boosts: 3, likes: 11 },
    pollState: { id: 'poll-1', multiple: false, expired: false, expiresAt: new Date(NOW + 2 * 86400_000).toISOString(), votes: 143, voters: 143, voted: false, ownVotes: [], options: [{ title: 'Birds in the school field', votes: 61 }, { title: 'Meteors (Geminids!)', votes: 52 }, { title: 'Litter on the walk in', votes: 30 }] },
    poll: ['Birds in the school field', 'Meteors (Geminids!)', 'Litter on the walk in'],
  }),
  post(['Finished the last episode. That ending.', 'The bit with the ship’s AI and the empty hangar is going to stay with me for a while.'], {
    by: 'grace', min: 160, cw: 'Spoilers: the season finale', counts: { replies: 8, boosts: 0, likes: 23 },
  }),
  post('Marché de la Croix-Rousse ce matin : les premières clémentines de Corse sont là. #lyon', { by: 'lea', min: 190, language: 'fr', counts: { replies: 1, boosts: 2, likes: 18 } }),
  post('Thursday supper is on: soup, bread and whatever the allotment gives us. Bring a bowl. Everyone welcome, pay what you can. #mutualaid', {
    by: 'hearth', min: 220, ...img(travel, 1600, 1067), alt: ['A long shared table by the sea'], counts: { replies: 5, boosts: 21, likes: 64 },
  }),
  { ...post('This is exactly how I want interfaces to feel: you notice what changed, and nothing moves under your thumb.', {
    by: 'theo', min: 250, counts: { replies: 2, boosts: 4, likes: 31 },
    quote: 'New replies now appear in place, marked New, while what you are reading stays still.',
  }), boostedBy: PEOPLE.mara.name, booster: { name: PEOPLE.mara.name, avatar: PEOPLE.mara.avatar, acct: PEOPLE.mara.acct, actor: actorOf('mara') } },
  post('撮影するなら、三脚に固定して10秒ほどの露出を何枚も撮り、あとで比較明合成すると光跡がきれいに残ります。今夜はぜひ。#ISS', { by: 'kenji', min: 280, language: 'ja', counts: { replies: 4, boosts: 30, likes: 140 } }),
  post('ISS visible pass — London 21:42, max elevation 71°, magnitude −3.6, appears WSW, disappears ENE.', { by: 'bot', min: 300, counts: { replies: 0, boosts: 18, likes: 40 } }),
  post('Glass that behaves like light: a slow walk around the new library. #architecture', { by: 'studio', min: 360, ...img(architecture, 1600, 1067), alt: ['A glass facade reflecting the sky'], counts: { replies: 3, boosts: 7, likes: 49 } }),
  post('Mein Teleskop ist endlich zurück aus der Reparatur. Erste Nacht damit: Saturn mit Ringen, ganz scharf. #astronomie', { by: 'jonas', min: 420, language: 'de', counts: { replies: 2, boosts: 1, likes: 27 } }),
  post('Shipping tonight: conversations in Atlas now fold long side-threads and keep new replies in place. #Atlas #fediverse', { by: 'me', min: 480, counts: { replies: 3, boosts: 6, likes: 38 }, liked: false }),
  post('A gentle reminder that “the algorithm” can be a list of people you chose, in the order they posted.', { by: 'mara', min: 540, counts: { replies: 9, boosts: 44, likes: 180 }, liked: true }),
  post('¿Alguien más usando un filtro de banda estrecha en la ciudad? Las fotos de la nebulosa de Orión cambiaron por completo.', { by: 'tomas', min: 600, language: 'es', counts: { replies: 1, boosts: 0, likes: 9 } }),
  post('Starlink trains are lovely and terrible. Lovely to watch, terrible across a 4-minute exposure.', { by: 'priya', min: 660, counts: { replies: 7, boosts: 5, likes: 72 }, bookmarked: true }),
];

/** Older Home, for "load more". */
export const HOME_OLDER: FedizenPost[] = [
  post('Note to self: the dew heater cable is in the blue box, not the red one.', { by: 'grace', min: 900 }),
  post('Library book sale tomorrow 10–2. The astronomy shelf is suspiciously full this year.', { by: 'sam', min: 1100 }),
  post('Les vélos en libre-service sont enfin revenus sur la presqu’île.', { by: 'lea', min: 1300, language: 'fr' }),
];

/** Posts for For You, with why each is there. */
export const FOR_YOU = [
  { ...HOME[0], reasons: [{ kind: 'following' as const }] },
  { ...post('If you only look up once this month: the Geminids peak on the 14th, and the Moon sets early. #astronomy #space', { by: 'priya', min: 140, counts: { replies: 11, boosts: 60, likes: 310 } }), reasons: [{ kind: 'tag' as const, tag: 'space' }] },
  { ...HOME[2], reasons: [{ kind: 'tag' as const, tag: 'astrophotography' }] },
  { ...post('Our dark-sky site list for the north is now a shared map. Corrections welcome. #astronomy', { by: 'jonas', min: 240, language: 'en' }), reasons: [{ kind: 'group' as const, group: 'Astronomy' }] },
  { ...HOME[7], reasons: [{ kind: 'following' as const }] },
];

export const MY_POSTS = [HOME[13], post('Trying out circles: one for the astronomy club, one for family.', { by: 'me', min: 2000 }), post('Hello, fediverse. Building #Atlas in the open.', { by: 'me', min: 9000, counts: { replies: 12, boosts: 8, likes: 61 } })];
export const ALL_POSTS: FedizenPost[] = [...HOME, ...HOME_OLDER, ...FOR_YOU, ...ISS_REPLIES, ...MY_POSTS];
export const byTag = (tag: string) => {
  const t = tag.toLowerCase(), seen = new Set<string>();
  return ALL_POSTS.filter(p => p.tags?.includes(t) && !seen.has(p.id) && seen.add(p.id));
};
