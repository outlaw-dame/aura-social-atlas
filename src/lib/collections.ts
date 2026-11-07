/**
 * Collections — curated sets of accounts to recommend, after Mastodon 4.6 Collections.
 *
 * Mastodon's rules, which Atlas collections follow too:
 *   - name ≤ 40 characters, description ≤ 100, one topic hashtag, a language, a sensitive flag, and
 *     public (discoverable) or unlisted visibility;
 *   - at most 25 accounts per collection (remote software may send up to 150) and 10 collections per person;
 *   - an account can be featured only with its consent: its server's `feature_approval` must allow it.
 *     Accounts whose policy is unknown or missing (other software, older Mastodon) cannot be added.
 *
 * Browser-safe: types, validation, consent decisions and Mastodon JSON mapping. Network and storage are in
 * collections.server.ts.
 */
import { z } from 'zod';

export const NAME_MAX = 40;
export const DESCRIPTION_MAX = 100;
export const ITEMS_MAX = 25;
export const REMOTE_ITEMS_MAX = 150;
export const COLLECTIONS_MAX = 10;

export type CollectionAccount = {
  /** ActivityPub actor id (the identity), or the Mastodon account URL when that is all we have. */
  actorUri: string;
  acct: string;
  name: string;
  avatar?: string;
  url?: string;
  state: 'accepted' | 'pending';
};

export type Collection = {
  id: string;
  source: 'atlas' | 'mastodon';
  name: string;
  description?: string;
  tag?: string;
  language?: string;
  sensitive: boolean;
  discoverable: boolean;
  curator: { name: string; acct?: string; avatar?: string; url?: string };
  items: CollectionAccount[];
  itemCount: number;
  /** Where the collection can be opened and shared. */
  url?: string;
  createdAt: string;
  updatedAt: string;
};

/* ── Input validation (shared by the editor and the server) ─────────────────────────────────── */

/** Mastodon's hashtag rule: letters, digits and _, not only digits. Returns the tag without '#', or null. */
export function normalizeTag(raw: string | null | undefined): string | null {
  const t = String(raw ?? '').trim().replace(/^#/, '');
  if (!t) return null;
  return /^[\p{L}\p{N}_]{1,100}$/u.test(t) && /[\p{L}_]/u.test(t) ? t : null;
}

const optionalText = (max: number) =>
  z.string().trim().max(max, `Descriptions can be up to ${max} characters.`).optional().transform(v => (v ? v : undefined));

export const collectionInput = z.object({
  name: z.string().trim().min(1, 'Give the collection a name.').max(NAME_MAX, `Names can be up to ${NAME_MAX} characters.`),
  description: optionalText(DESCRIPTION_MAX),
  tag: z.string().trim().max(101).optional().transform((v, ctx) => {
    if (!v) return undefined;
    const t = normalizeTag(v);
    if (!t) { ctx.addIssue({ code: 'custom', message: 'Use one hashtag: letters, numbers and _ only.' }); return z.NEVER; }
    return t;
  }),
  language: z.string().trim().toLowerCase().regex(/^[a-z]{2,3}$/, 'Use a two-letter language code.').optional().or(z.literal('').transform(() => undefined)),
  sensitive: z.boolean().default(false),
  discoverable: z.boolean().default(true),
});
export type CollectionInput = z.infer<typeof collectionInput>;

/* ── Consent: Mastodon's FeatureApproval ────────────────────────────────────────────────────── */

export type FeatureApproval = { automatic?: unknown; manual?: unknown; current_user?: unknown };
export type FeatureDecision = 'automatic' | 'manual' | 'denied';

const KNOWN = new Set(['public', 'followers', 'following']);
const policies = (v: unknown) =>
  (Array.isArray(v) ? v : []).map(x => (typeof x === 'string' && KNOWN.has(x) ? x : 'unsupported_policy'));

/**
 * Can Atlas feature this account? Atlas asks as a third party (not a follower or followee on the account's
 * server), so only a `public` policy applies: automatic → can add; manual → needs the owner's approval
 * (Mastodon itself doesn't offer manual approval yet); anything else, unknown or missing → no.
 */
export function featureDecision(approval: FeatureApproval | null | undefined): FeatureDecision {
  if (!approval || typeof approval !== 'object') return 'denied';
  if (policies(approval.automatic).includes('public')) return 'automatic';
  if (policies(approval.manual).includes('public')) return 'manual';
  return 'denied';
}

export const FEATURE_DENIED_REASON: Record<'denied' | 'missing' | 'not-found' | 'unsupported-network', string> = {
  denied: 'This person hasn’t opted in to being featured in collections.',
  missing: 'Their server doesn’t say whether they can be featured, so they can’t be added.',
  'not-found': 'Couldn’t find that account. Use the full handle, like @name@server.social.',
  'unsupported-network': 'Only fediverse accounts that have opted in to being featured can be added.',
};

/* ── Mastodon API JSON → Collection ─────────────────────────────────────────────────────────── */

type Json = Record<string, unknown>;
const obj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown) => (typeof v === 'string' ? v : undefined);
const https = (v: unknown) => { const u = s(v); return u && /^https:\/\//i.test(u) ? u : undefined; };
const stripHtml = (html: string) => html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

/** A Mastodon Account → a collection member (or curator). `host` completes local accts ("jane" → "jane@host"). */
export function accountFromMastodon(a: unknown, host: string, state: CollectionAccount['state'] = 'accepted'): CollectionAccount | null {
  if (!obj(a)) return null;
  const url = https(a.url);
  const acctRaw = s(a.acct);
  if (!acctRaw || !url) return null;
  const acct = `@${acctRaw.includes('@') ? acctRaw : `${acctRaw}@${host}`}`;
  return {
    actorUri: https(a.uri) ?? url,
    acct,
    name: (s(a.display_name) || s(a.username) || acct).slice(0, 80),
    avatar: https(a.avatar_static) ?? https(a.avatar),
    url,
    state,
  };
}

/**
 * Mastodon's CollectionWithAccounts ({ collection, accounts }) → Collection. Only accepted items are shown
 * to people other than the curator, matching Mastodon.
 */
export function collectionFromMastodon(data: unknown, host: string): Collection | null {
  if (!obj(data) || !obj(data.collection)) return null;
  const c = data.collection;
  const id = s(c.id);
  const name = s(c.name);
  if (!id || !name) return null;
  const accounts = new Map<string, Json>();
  for (const a of Array.isArray(data.accounts) ? data.accounts : []) if (obj(a) && s(a.id)) accounts.set(s(a.id)!, a);
  const owner = accountFromMastodon(accounts.get(s(c.account_id) ?? ''), host);
  const items = (Array.isArray(c.items) ? c.items : [])
    .filter(i => obj(i) && i.state === 'accepted')
    .map(i => accountFromMastodon(accounts.get(s((i as Json).account_id) ?? ''), host))
    .filter((a): a is CollectionAccount => !!a)
    .slice(0, REMOTE_ITEMS_MAX);
  const tag = obj(c.tag) ? normalizeTag(s(c.tag.name)) ?? undefined : undefined;
  return {
    id,
    source: 'mastodon',
    name: name.slice(0, 100),
    description: s(c.description) ? stripHtml(s(c.description)!).slice(0, 500) : undefined,
    tag,
    language: s(c.language),
    sensitive: c.sensitive === true,
    discoverable: c.discoverable !== false,
    curator: owner ? { name: owner.name, acct: owner.acct, avatar: owner.avatar, url: owner.url } : { name: host },
    items,
    itemCount: typeof c.item_count === 'number' ? c.item_count : items.length,
    url: https(c.url),
    createdAt: s(c.created_at) ?? '',
    updatedAt: s(c.updated_at) ?? s(c.created_at) ?? '',
  };
}

/** A shared Mastodon collection link (https://server/collections/:id) → where to read it from the API. */
export function mastodonCollectionApi(link: string): { host: string; api: string } | null {
  let u: URL;
  try { u = new URL(link); } catch { return null; }
  const m = /^\/collections\/([A-Za-z0-9_-]{1,64})\/?$/.exec(u.pathname);
  if (u.protocol !== 'https:' || !m) return null;
  return { host: u.hostname.toLowerCase(), api: `https://${u.hostname.toLowerCase()}/api/v1/collections/${m[1]}` };
}

/** "@user@server" (or "user@server", or a profile URL like https://server/@user) → parts, or null. */
export function parseFediHandle(raw: string): { user: string; host: string } | null {
  const v = raw.trim();
  const url = /^https:\/\/([a-z0-9.-]+\.[a-z]{2,63})\/@([a-z0-9_.-]{1,64})\/?$/i.exec(v);
  if (url) return { user: url[2], host: url[1].toLowerCase() };
  const m = /^@?([a-z0-9_.-]{1,64})@([a-z0-9.-]{1,253}\.[a-z]{2,63})$/i.exec(v);
  return m ? { user: m[1], host: m[2].toLowerCase() } : null;
}
