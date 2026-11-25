/**
 * Living with Fedizen's rate limit (server only).
 *
 * Fedizen answers 429 Too Many Requests when Atlas asks too much (seen live on Railway, 2026-11-22, after repeated
 * native Home loads). Asking again straight away only extends it, so:
 * - after a 429, that account's requests wait out Fedizen's Retry-After (seconds or an HTTP date; 1 s to 2 min, 15 s
 *   when Fedizen doesn't say) without being sent;
 * - Atlas's server reaches Fedizen from one address, so when several different accounts are limited within a minute,
 *   the limit is likely per address and every account waits;
 * - single-post reads are kept for 30 s per account (repeat loads read each post again), and dropped as soon as that
 *   account writes anything, so its own likes, boosts and replies always show at once.
 * Accounts are told apart by a hash of their token; no token is kept here.
 */

import { _resetMicrocache, forgetMicrocache } from './fedizen-microcache';

const DEFAULT_WAIT_MS = 15_000;
const MIN_WAIT_MS = 1_000;
const MAX_WAIT_MS = 120_000;
const SHARED_WINDOW_MS = 60_000;
const SHARED_AFTER_ACCOUNTS = 3;
export const STATUS_CACHE_MS = 30_000;
const STATUS_CACHE_MAX = 500;

/** How long Fedizen asked Atlas to wait, from its Retry-After header, kept within 1 s and 2 min. */
export function retryAfterMs(header: string | null | undefined, now: number = Date.now()): number {
  const value = header?.trim();
  let ms = DEFAULT_WAIT_MS;
  if (value) {
    if (/^\d+$/.test(value)) ms = Number(value) * 1000;
    else {
      const at = Date.parse(value);
      if (!Number.isNaN(at)) ms = at - now;
    }
  }
  return Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, ms));
}

/** A short, non-reversible name for an account's token (SHA-256, first 16 bytes, hex). */
export async function accountKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest).slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
}

const waitUntil = new Map<string, number>();
let sharedUntil = 0;
const recent: { account: string; at: number }[] = [];

/** How much longer this account must wait before asking Fedizen again (0: it may ask now). */
export function waitLeft(account: string, now: number = Date.now()): number {
  const own = waitUntil.get(account) ?? 0;
  if (own && own <= now) waitUntil.delete(account);
  return Math.max(0, own - now, sharedUntil - now);
}

/** Fedizen said 429 to this account: it waits, and when several accounts were limited lately, all of them do. */
export function noteRateLimited(account: string, retryAfter: string | null | undefined, now: number = Date.now()): number {
  const ms = retryAfterMs(retryAfter, now);
  waitUntil.set(account, Math.max(waitUntil.get(account) ?? 0, now + ms));
  recent.push({ account, at: now });
  while (recent.length && recent[0].at < now - SHARED_WINDOW_MS) recent.shift();
  if (new Set(recent.map(r => r.account)).size >= SHARED_AFTER_ACCOUNTS) sharedUntil = Math.max(sharedUntil, now + ms);
  if (waitUntil.size > 5_000) for (const [k, until] of waitUntil) if (until <= now) waitUntil.delete(k);
  return ms;
}

type Cached = { at: number; value: unknown };
const statuses = new Map<string, Cached>();
const cacheKey = (account: string, path: string) => `${account} ${path}`;

/** A post this account read within the last 30 s, if any. */
export function cachedStatus(account: string, path: string, now: number = Date.now()): unknown | undefined {
  const key = cacheKey(account, path);
  const hit = statuses.get(key);
  if (!hit) return undefined;
  if (now - hit.at > STATUS_CACHE_MS) { statuses.delete(key); return undefined; }
  return hit.value;
}

export function keepStatus(account: string, path: string, value: unknown, now: number = Date.now()): void {
  if (statuses.size >= STATUS_CACHE_MAX) statuses.delete(statuses.keys().next().value as string);
  statuses.set(cacheKey(account, path), { at: now, value });
}

/** This account changed something on Fedizen: what it read before may no longer be true. */
export function forgetAccountReads(account: string): void {
  const prefix = `${account} `;
  for (const key of statuses.keys()) if (key.startsWith(prefix)) statuses.delete(key);
  // And its micro-cached reads (fedizen-microcache.ts), so its own like, reply or block shows on the next read.
  forgetMicrocache(account);
}

/** Test seam. */
export function resetRateLimitState(): void {
  waitUntil.clear(); statuses.clear(); recent.length = 0; sharedUntil = 0;
  _resetMicrocache();
}
