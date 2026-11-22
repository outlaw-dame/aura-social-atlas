import { useSyncExternalStore } from 'react';

/**
 * How much each keyword filter has caught: the posts it hid, warned on or blurred, counted once each, over the last
 * 30 days. Shown beside each filter in Settings (instead of a notice wherever a post was filtered, which Activity
 * doesn't show). Counted where Atlas filters, in the browser, as posts are read: Fedizen doesn't filter for Atlas, so
 * it has nothing to count. Kept per account on this device (localStorage), never sent anywhere.
 */
export const STATS_DAYS = 30;
const WINDOW = STATS_DAYS * 86_400_000;
const PER_FILTER = 2000;
const key = (scope: string) => `atlas.filter-stats.${scope}`;

/** filterId → post key → when first caught (ms). */
type Stats = Record<string, Record<string, number>>;

let scope: string | null = null;
let stats: Stats = {};
let version = 0;
const listeners = new Set<() => void>();
let saving: ReturnType<typeof setTimeout> | null = null;

function load(s: string) {
  scope = s;
  try { const raw = localStorage.getItem(key(s)); stats = raw ? (JSON.parse(raw) as Stats) : {}; } catch { stats = {}; }
  if (!stats || typeof stats !== 'object') stats = {};
  prune(Date.now());
}
function prune(now: number) {
  for (const [f, posts] of Object.entries(stats)) {
    if (!posts || typeof posts !== 'object') { delete stats[f]; continue; }
    const kept = Object.entries(posts).filter(([, t]) => typeof t === 'number' && now - t < WINDOW).sort((a, b) => b[1] - a[1]).slice(0, PER_FILTER);
    if (kept.length) stats[f] = Object.fromEntries(kept); else delete stats[f];
  }
}
function save() {
  if (saving) return;
  saving = setTimeout(() => {
    saving = null;
    try { if (scope) localStorage.setItem(key(scope), JSON.stringify(stats)); } catch { /* full or private: counts last this session */ }
  }, 1000);
}
const tell = () => { version++; listeners.forEach(l => l()); };

/** A filter caught a post (any action), seen by this account. Counting the same post again does nothing. */
export function recordFiltered(account: string, filterId: string, postKey: string, now = Date.now()) {
  if (scope !== account) load(account);
  const posts = (stats[filterId] ??= {});
  if (posts[postKey] !== undefined) return;
  posts[postKey] = now;
  if (Object.keys(posts).length > PER_FILTER) prune(now);
  save();
  tell();
}

/** Posts each filter caught in the last 30 days, for this account. */
export function filteredCounts(account: string, now = Date.now()): Map<string, number> {
  if (scope !== account) load(account);
  const out = new Map<string, number>();
  for (const [f, posts] of Object.entries(stats)) out.set(f, Object.values(posts).filter(t => now - t < WINDOW).length);
  return out;
}

/** Forget a filter's count (it was removed). */
export function forgetFilterStats(account: string, filterId: string) {
  if (scope !== account) load(account);
  if (!(filterId in stats)) return;
  delete stats[filterId];
  save();
  tell();
}

/** The counts, kept current as feeds filter posts. Empty without an account. */
export function useFilteredCounts(account: string | null | undefined): Map<string, number> {
  const v = useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => version, () => 0);
  return account ? countsAt(account, v) : EMPTY;
}
const EMPTY = new Map<string, number>();
let memo: { account: string; v: number; counts: Map<string, number> } | null = null;
function countsAt(account: string, v: number) {
  if (!memo || memo.account !== account || memo.v !== v) memo = { account, v, counts: filteredCounts(account) };
  return memo.counts;
}

/** "Filtered 12 posts in the last 30 days", "Nothing filtered in the last 30 days". */
export function countLabel(n: number | undefined): string {
  return !n ? `Nothing filtered in the last ${STATS_DAYS} days` : `Filtered ${n} post${n === 1 ? '' : 's'} in the last ${STATS_DAYS} days`;
}

/** Above the list: what all filters caught together, and where it was counted. */
export function totalLabel(filters: { id: string }[], counts: Map<string, number>): string {
  const n = filters.reduce((a, f) => a + (counts.get(f.id) ?? 0), 0);
  return `${n ? `Your filters caught ${n} post${n === 1 ? '' : 's'}` : 'Your filters haven’t caught anything'} in the last ${STATS_DAYS} days, counted on this device as you read.`;
}

/** For tests: start from nothing. */
export function resetFilterStats() { scope = null; stats = {}; memo = null; version++; }
