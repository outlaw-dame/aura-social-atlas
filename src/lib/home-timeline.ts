/**
 * Keeping Home fresh without moving what's being read — the parts that don't need React, so they can be tested.
 *
 * How the big three do it (checked November 2026):
 * - Bonfire's own web app pushes each new activity over PubSub, inserts it hidden, and shows "Show N new activities";
 *   your own posts appear at once (bonfire_ui_social feed_live.ex, do_insert_new_activity).
 * - Mastodon's web app streams Home; posts slide in at the top, or wait behind "N new items" in Slow mode
 *   (setting_use_pending_items); while the stream is down it polls every 20–40 s (actions/streaming.js).
 * - Bluesky polls every 60 s for the single newest post, and shows a "Load new posts" button; it never changes the
 *   feed under the reader (social-app PostFeed.tsx, FeedPage.tsx).
 * Atlas can't hold a stream (the Fedizen token stays on its server), so it checks like Bluesky, but more often while
 * the person is reading and less when they aren't, and shows new posts as Bonfire and Mastodon do.
 */

type P = { id: string; statusId?: string; date?: string };

/** Posts in `latest` that the reader doesn't have yet, newest first; `gap` when none of `latest` overlaps what's shown
 *  (more arrived than one page holds, so posts in between weren't loaded). */
export function newerThan<T extends P>(current: T[], latest: T[]): { fresh: T[]; gap: boolean } {
  if (!current.length) return { fresh: latest, gap: false };
  const have = new Set(current.map(p => p.id));
  const top = current.reduce((t, p) => Math.max(t, p.date ? Date.parse(p.date) || 0 : 0), 0);
  const fresh = latest.filter(p => !have.has(p.id) && (!p.date || !top || Date.parse(p.date) >= top));
  const gap = fresh.length > 0 && latest.length > 0 && !latest.some(p => have.has(p.id));
  return { fresh, gap };
}

/** Appends an older page, leaving out anything already shown (pages can overlap when posts arrive in between). */
export function appendOlder<T extends P>(current: T[], page: T[]): T[] {
  const have = new Set(current.map(p => p.id));
  return [...current, ...page.filter(p => !have.has(p.id))];
}

/** How long to wait before the next check: 30 s while new posts keep coming or the reader is active, then longer each
 *  quiet check, up to 5 minutes. */
export const CHECK_MIN = 30_000, CHECK_MAX = 300_000;
export function nextCheckDelay(previous: number, foundNew: boolean, active: boolean): number {
  if (foundNew || active) return CHECK_MIN;
  return Math.min(CHECK_MAX, Math.round(previous * 1.5));
}

/** Home as last seen, kept on this device so Atlas opens on it at once (then checks for what's new). */
const CACHE_KEY = (uid: string) => `atlas-home:${uid}`;
export const CACHE_MAX_AGE = 6 * 3_600_000;
const CACHE_MAX_BYTES = 1_500_000;
export type CachedHome<T> = { v: 1; savedAt: number; data: T };

export function readHomeCache<T>(uid: string, now = Date.now()): CachedHome<T> | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY(uid));
    if (!raw) return null;
    const c = JSON.parse(raw) as CachedHome<T>;
    if (c?.v !== 1 || typeof c.savedAt !== 'number' || now - c.savedAt > CACHE_MAX_AGE || now < c.savedAt) return null;
    return c;
  } catch { return null; }
}

export function writeHomeCache<T>(uid: string, data: T, now = Date.now()) {
  try {
    const raw = JSON.stringify({ v: 1, savedAt: now, data } satisfies CachedHome<T>);
    if (raw.length <= CACHE_MAX_BYTES) localStorage.setItem(CACHE_KEY(uid), raw);
  } catch { /* storage full or unavailable: Atlas just loads as before */ }
}

/** Forgets the saved Home (on disconnecting Fedizen, signing out, or switching account). */
export function clearHomeCache(uid: string) {
  try { localStorage.removeItem(CACHE_KEY(uid)); } catch { /* nothing to clear */ }
}
