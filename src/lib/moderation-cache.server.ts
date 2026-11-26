/**
 * What Atlas asks Fedizen about a person's moderation, kept briefly per Atlas account (server only), so Spotlight and
 * replies read from other servers don't each read the complete block and mute lists, and look up the same reply
 * authors, every time a conversation opens or refreshes. That load ran Fedizen's rate limit, and then the person's own
 * likes and conversation reads were refused (seen on Railway, 26 Nov 2026).
 *
 * - The block and mute lists (complete or nothing): 3 minutes, one read shared by everyone asking at once.
 * - Reply authors as Fedizen knows them (an account id, or not known to it): 30 minutes.
 * - The person's relationship with those authors (blocking, muting, their server blocked): 3 minutes.
 * Everything is kept per Atlas account AND the Fedizen account it's connected to (`scope`, moderationScope), so
 * reconnecting another Fedizen account never uses the last one's lists. Blocking or muting someone, or a server,
 * through Atlas, connecting or disconnecting Fedizen, forgets all of it for that person at once (forgetModeration).
 * A change made on Fedizen itself shows within those times.
 */
import type { SpotlightModeration } from './spotlight-curation';

export const MODERATION_MS = 3 * 60_000;
export const AUTHOR_MS = 30 * 60_000;
export const RELATION_MS = 3 * 60_000;
const MAX_ENTRIES = 20_000;

type Rel = { blocking?: boolean | null; muting?: boolean | null; domain_blocking?: boolean | null };
const lists = new Map<string, { at: number; value: Promise<SpotlightModeration | null> }>();
const authors = new Map<string, { at: number; id?: string; unknown: boolean }>();
const relations = new Map<string, { at: number; rel: Rel }>();
const key = (scope: string, k: string) => `${scope} ${k}`;

/** Whose moderation this is: the Atlas account and a hash of its Fedizen token (never the token itself). */
export async function moderationScope(userId: string, token: string): Promise<string> {
  const { accountKey } = await import('./fedizen-rate-limit');
  return `${userId}|${await accountKey(token)}`;
}
function trim<V>(m: Map<string, V>) { while (m.size > MAX_ENTRIES) m.delete(m.keys().next().value!); }

/** The block and mute lists, read through `read` at most every MODERATION_MS; a failed read isn't kept. */
export function cachedModeration(scope: string, read: () => Promise<SpotlightModeration | null>, now = Date.now()): Promise<SpotlightModeration | null> {
  const hit = lists.get(scope);
  if (hit && now - hit.at < MODERATION_MS) return hit.value;
  const value = read().catch(() => null);
  lists.set(scope, { at: now, value });
  void value.then(v => { if (!v && lists.get(scope)?.value === value) lists.delete(scope); });
  trim(lists);
  return value;
}

/** A reply author as Fedizen knows them, if looked up lately: its id, or `unknown` (Fedizen answered 404). */
export function knownAuthor(scope: string, acct: string, now = Date.now()): { id?: string; unknown: boolean } | undefined {
  const hit = authors.get(key(scope, acct));
  if (!hit || now - hit.at >= AUTHOR_MS) return undefined;
  return { ...(hit.id ? { id: hit.id } : {}), unknown: hit.unknown };
}
/** Keeps an answer about an author: only a definite one (an id, or 404); a failed lookup is asked again. */
export function keepAuthor(scope: string, acct: string, a: { id?: string; unknown: boolean }, now = Date.now()) {
  if (!a.id && !a.unknown) return;
  authors.set(key(scope, acct), { at: now, ...a });
  trim(authors);
}

export function knownRelation(scope: string, accountId: string, now = Date.now()): Rel | undefined {
  const hit = relations.get(key(scope, accountId));
  return hit && now - hit.at < RELATION_MS ? hit.rel : undefined;
}
export function keepRelation(scope: string, accountId: string, rel: Rel, now = Date.now()) {
  relations.set(key(scope, accountId), { at: now, rel: { blocking: rel.blocking, muting: rel.muting, domain_blocking: rel.domain_blocking } });
  trim(relations);
}

/**
 * The person blocked or muted someone (or a server) through Atlas, or connected or disconnected Fedizen: everything
 * kept for their Atlas account, whichever Fedizen account it was for, is read afresh.
 */
export function forgetModeration(userId: string) {
  const prefix = `${userId}|`;
  for (const m of [lists, authors, relations] as Map<string, unknown>[]) for (const k of m.keys()) if (k.startsWith(prefix)) m.delete(k);
}

export function _resetModerationCache() { lists.clear(); authors.clear(); relations.clear(); }
