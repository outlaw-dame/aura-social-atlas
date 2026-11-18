/**
 * Sample people for the Device Lab. Invented names and handles on real-looking servers; their pictures are Atlas's
 * own memoji or drawn initials, since an artifact page can't load images from other sites.
 */
import { AVATAR_PRESETS } from '@/lib/atlas-avatars';

const memoji = (n: 1 | 2 | 3 | 4) => AVATAR_PRESETS[n - 1].src;

/** A round avatar with initials, as an SVG data URI (works offline and in the artifact's sandbox). */
export function initials(name: string, color: string): string {
  const letters = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${color}"/><text x="48" y="60" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="38" font-weight="600" text-anchor="middle" fill="#fff">${letters}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export type Person = { key: string; name: string; acct: string; avatar: string; bio: string[]; kind?: 'person' | 'group' | 'bot' | 'organization' | 'podcast' | 'channel'; followers: number; following: number; posts: number; joined: string; fields?: { name: string; value: string }[]; locked?: boolean };

const p = (key: string, name: string, acct: string, avatar: string, bio: string[], n: [number, number, number], joined: string, extra: Partial<Person> = {}): Person =>
  ({ key, name, acct, avatar, bio, followers: n[0], following: n[1], posts: n[2], joined, ...extra });

export const PEOPLE = {
  orbit: p('orbit', 'Notes from Orbit', 'notesfromorbit@mastodon.social', memoji(2), ['A little perspective from beyond our planet. Dispatches on #space and #science, written slowly.'], [48100, 312, 2140], '2020-11-02', { fields: [{ name: 'Website', value: 'notesfromorbit.space' }] }),
  studio: p('studio', 'The Material Studio', 'materialstudio@bsky.brid.gy', memoji(1), ['Objects, spaces, and the people who make them. Weekly notes on #design and #interiors.'], [12400, 180, 620], '2023-03-14'),
  ana: p('ana', 'Ana Rivera', 'ana@fosstodon.org', memoji(3), ['Amateur astronomer, weekend cyclist, maintainer of a small open-source star chart.'], [1830, 402, 3120], '2022-11-08', { fields: [{ name: 'Pronouns', value: 'she/her' }] }),
  grace: p('grace', 'Grace Lin', 'grace@hachyderm.io', memoji(4), ['Infrastructure engineer. Photographs night skies badly and enthusiastically.'], [960, 288, 1410], '2022-12-01'),
  sam: p('sam', 'Sam Okafor', 'sam@mastodon.online', memoji(1), ['Teacher in Manchester. Clouds, cricket and #CitizenScience.'], [740, 510, 2290], '2021-04-19'),
  mika: p('mika', 'Mika Sato', 'mika@fedibird.com', initials('Mika Sato', '#E9967A'), ['札幌の星空と写真。', 'Night skies and photos from Sapporo.'], [2210, 330, 4870], '2020-05-30'),
  lea: p('lea', 'Léa Martin', 'lea@piaille.fr', initials('Léa Martin', '#7FA7D9'), ['Lyon. Cartes, vélos et ciel couvert.'], [512, 240, 980], '2022-11-21'),
  tomas: p('tomas', 'Tomás Ruiz', 'tomas@mastodon.uy', initials('Tomás Ruiz', '#8BC34A'), ['Fotografía, astronomía y café.'], [389, 199, 760], '2023-02-02'),
  priya: p('priya', 'Priya Nair', 'priya@astrodon.social', initials('Priya Nair', '#B39DDB'), ['Satellite tracker. Will tell you when the ISS is overhead.'], [3020, 410, 5230], '2021-09-09'),
  jonas: p('jonas', 'Jonas Weber', 'jonas@norden.social', initials('Jonas Weber', '#4DB6AC'), ['Sternwarte Hamburg-Bergedorf, Ehrenamt.'], [640, 270, 1150], '2022-11-10'),
  kenji: p('kenji', 'Kenji Mori', 'kenji@mstdn.jp', initials('Kenji Mori', '#FFB74D'), ['星景写真。長時間露光が好き。'], [4120, 380, 6230], '2019-08-12'),
  hearth: p('hearth', 'Hearth & Commons', 'hearth@fedizen.net', initials('Hearth Commons', '#C2185B'), ['A neighbourhood food co-op. Posts about markets, recipes and shared tables.'], [2380, 90, 450], '2024-05-02', { kind: 'organization' }),
  theo: p('theo', 'Theo Park', 'theo@fedizen.net', initials('Theo Park', '#00838F'), ['Designer. Building calmer interfaces.'], [870, 520, 1990], '2025-01-11'),
  mara: p('mara', 'Mara Quinn', 'mara@social.coop', initials('Mara Quinn', '#6D4C41'), ['Co-op organiser. Collections of people worth knowing.'], [1540, 760, 2650], '2021-06-03'),
  bot: p('bot', 'ISS Pass Bot', 'isspass@botsin.space', initials('ISS Bot', '#455A64'), ['Automated: visible International Space Station passes for big cities.'], [8900, 0, 15200], '2020-02-02', { kind: 'bot' }),
} satisfies Record<string, Person>;

export type PersonKey = keyof typeof PEOPLE;
export const actorOf = (k: PersonKey) => { const [user, host] = PEOPLE[k].acct.split('@'); return `https://${host}/users/${user}`; };
export const profileUrl = (k: PersonKey) => { const [user, host] = PEOPLE[k].acct.split('@'); return `https://${host}/@${user}`; };
export const personByAcct = (acct: string) => Object.values(PEOPLE).find(x => x.acct.toLowerCase() === acct.replace(/^@/, '').toLowerCase());
