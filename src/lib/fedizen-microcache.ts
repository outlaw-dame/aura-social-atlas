/**
 * Micro-caching of Fedizen reads (server only).
 *
 * Opening Feeds reads the same thing from Fedizen several times within a second: Following's first page by
 * getFedizenHome, by Home's first "anything new?" check (getFedizenHomeLatest) and by For You (getForYou); the
 * notifications by Home and its check; the followed hashtags by For You and by the tag marks (getFollowedTags); the
 * instance's limits by three features. Each of those is a full round trip to a server that is sometimes slow and
 * rate-limits Atlas. So, as NGINX's microcaching does for a site (a 1 s cache with proxy_cache_lock):
 * - identical reads in flight are joined (request coalescing, Go's singleflight): one goes to Fedizen, the others
 *   wait for its answer;
 * - a read that came back 200 is reused for a few seconds (MICRO_MS, longer for the instance's settings), then read
 *   again;
 * - always per account (a hash of its token, never the token), with the exact path and options in the key, so one
 *   person's timeline can never be served to another;
 * - anything the account writes (a like, a reply, a block, a GraphQL mutation) forgets that account's reads at once
 *   (forgetAccountReads), so its own actions always show;
 * - a conversation (statuses/:id/context) is only joined, never reused, so a reply that just arrived isn't hidden;
 * - every caller gets its own copy, so one caller changing what it got can't change another's;
 * - bounded: at most MAX_ENTRIES answers kept, oldest dropped first.
 */

export const MICRO_MS = 3_000;
const LONG_MS = 10 * 60_000;
const MAX_ENTRIES = 400;

/** How long a 200 for this path may be reused: 0 = join reads in flight only. */
export function reuseFor(path: string): number {
  if (/^\/api\/v1\/statuses\/[^/?]+\/context$/.test(path)) return 0;
  if (path === '/api/v2/instance') return LONG_MS;
  return MICRO_MS;
}

type Answer = { status: number; data: unknown[]; [k: string]: unknown };
const inflight = new Map<string, Promise<Answer>>();
const kept = new Map<string, { until: number; value: Answer }>();

const copy = <T>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)) as T);

/**
 * The read for `account` and `key`, through the micro-cache: kept answer, else the read already on its way, else
 * `read()`. Only a 200 is kept; anything else is shared with whoever was waiting and then forgotten.
 */
export async function microcached<T extends Answer>(account: string, key: string, ttl: number, read: () => Promise<T>, now = Date.now): Promise<T> {
  const k = `${account} ${key}`;
  const hit = kept.get(k);
  if (hit && hit.until > now()) return copy(hit.value) as T;
  if (hit) kept.delete(k);
  let p = inflight.get(k) as Promise<T> | undefined;
  if (!p) {
    p = read().then(v => {
      if (ttl > 0 && v.status === 200 && inflight.get(k) === p) {
        kept.set(k, { until: now() + ttl, value: v });
        while (kept.size > MAX_ENTRIES) kept.delete(kept.keys().next().value!);
      }
      return v;
    }).finally(() => { if (inflight.get(k) === p) inflight.delete(k); });
    inflight.set(k, p);
  }
  return copy(await p);
}

/** This account changed something: drop what it read (reads still in flight finish, but aren't kept). */
export function forgetMicrocache(account: string) {
  const prefix = `${account} `;
  for (const k of kept.keys()) if (k.startsWith(prefix)) kept.delete(k);
  for (const k of inflight.keys()) if (k.startsWith(prefix)) inflight.delete(k);
}

/** For tests. */
export function _resetMicrocache() { kept.clear(); inflight.clear(); }
