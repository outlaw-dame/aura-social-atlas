/**
 * What Atlas asks Fedizen about a person's moderation, kept briefly per Atlas account (server only), so Spotlight and
 * replies read from other servers don't each read the complete block and mute lists, and look up the same reply
 * authors, every time a conversation opens or refreshes. That load ran Fedizen's rate limit, and then the person's own
 * likes and conversation reads were refused (seen on Railway, 26 Nov 2026).
 *
 * - The block and mute lists (complete or nothing): 3 minutes, one read shared by everyone asking at once.
 * - Reply authors as Fedizen knows them (an account id, or not known to it): 30 minutes.
 * - The person's relationship with those authors (blocking, muting, their server blocked): 3 minutes.
 * Blocking or muting someone, or a server, through Atlas forgets all of it for that person at once
 * (forgetModeration). A change made on Fedizen itself shows within those times.
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
const key = (userId: string, k: string) => `${userId} ${k}`;
function trim<V>(m: Map<string, V>) { while (m.size > MAX_ENTRIES) m.delete(m.keys().next().value!); }

/** The block and mute lists, read through `read` at most every MODERATION_MS; a failed read isn't kept. */
export function cachedModeration(userId: string, read: () => Promise<SpotlightModeration | null>, now = Date.now()): Promise<SpotlightModeration | null> {
  const hit = lists.get(userId);
  if (hit && now - hit.at < MODERATION_MS) return hit.value;
  const value = read().catch(() => null);
  lists.set(userId, { at: now, value });
  void value.then(v => { if (!v && lists.get(userId)?.value === value) lists.delete(userId); });
  trim(lists);
  return value;
}

/** A reply author as Fedizen knows them, if looked up lately: its id, or `unknown` (Fedizen answered 404). */
export function knownAuthor(userId: string, acct: string, now = Date.now()): { id?: string; unknown: boolean } | undefined {
  const hit = authors.get(key(userId, acct));
  if (!hit || now - hit.at >= AUTHOR_MS) return undefined;
  return { ...(hit.id ? { id: hit.id } : {}), unknown: hit.unknown };
}
/** Keeps an answer about an author: only a definite one (an id, or 404); a failed lookup is asked again. */
export function keepAuthor(userId: string, acct: string, a: { id?: string; unknown: boolean }, now = Date.now()) {
  if (!a.id && !a.unknown) return;
  authors.set(key(userId, acct), { at: now, ...a });
  trim(authors);
}

export function knownRelation(userId: string, accountId: string, now = Date.now()): Rel | undefined {
  const hit = relations.get(key(userId, accountId));
  return hit && now - hit.at < RELATION_MS ? hit.rel : undefined;
}
export function keepRelation(userId: string, accountId: string, rel: Rel, now = Date.now()) {
  relations.set(key(userId, accountId), { at: now, rel: { blocking: rel.blocking, muting: rel.muting, domain_blocking: rel.domain_blocking } });
  trim(relations);
}

/** The person blocked or muted someone (or a server) through Atlas: their lists and relationships are read afresh. */
export function forgetModeration(userId: string) {
  lists.delete(userId);
  const prefix = `${userId} `;
  for (const k of relations.keys()) if (k.startsWith(prefix)) relations.delete(k);
}

export function _resetModerationCache() { lists.clear(); authors.clear(); relations.clear(); }
