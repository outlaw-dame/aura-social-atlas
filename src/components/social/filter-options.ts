import { FILTER_PLACES, fromMastodonExport, parseFilterList, toMastodonExport, type ContentFilter, type FilterAction, type FilterPlace } from '@/lib/content-filter';
import { DEFAULT_OPTIONS, type FilterOptions } from './useIntelligence';

/** Words for filter options, shared by desktop and phone. */
export const ACTION_LABEL: Record<FilterAction, string> = { hide: 'Hide', warn: 'Hide behind a warning', blur: 'Hide media only' };
export const ACTION_SHORT: Record<FilterAction, string> = { hide: 'Hide', warn: 'Warn', blur: 'Media' };
export const PLACE_LABEL: Record<FilterPlace, string> = { home: 'Home and For You', public: 'Hashtags, Local and groups', account: 'Profiles' };
/** How long a filter lasts (Bluesky offers 24 hours, 7 days, 30 days or forever). */
export const DURATIONS: { label: string; ms: number | null }[] = [
  { label: 'Forever', ms: null }, { label: '24 hours', ms: 86_400_000 }, { label: '7 days', ms: 7 * 86_400_000 }, { label: '30 days', ms: 30 * 86_400_000 },
];
export const expiresAfter = (ms: number | null) => (ms === null ? null : new Date(Date.now() + ms).toISOString());

/** One line saying what a filter does when it isn't the default: hidden everywhere, forever, for everyone. */
export function filterSummary(f: ContentFilter, now = Date.now()): string {
  const parts: string[] = [];
  if (f.action !== 'hide') parts.push(ACTION_LABEL[f.action]);
  if (f.places.length < FILTER_PLACES.length) parts.push(`Only in ${f.places.map(p => PLACE_LABEL[p]).join('; ')}`);
  if (f.exceptFollowing) parts.push('Not from people you follow');
  if (f.expiresAt) {
    const t = Date.parse(f.expiresAt);
    parts.push(t <= now ? 'Expired' : `Until ${new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
  }
  return parts.join(' · ');
}

/** What an import box or file holds: a Mastodon filter export (JSON), or a plain list (Fedizen's, one per line). */
export function parseImport(raw: string, fallback: FilterOptions = DEFAULT_OPTIONS): { texts: string[]; options: FilterOptions }[] {
  const t = raw.trim();
  if (t.startsWith('{')) {
    try {
      const items = fromMastodonExport(JSON.parse(t));
      if (items) {
        // One call per set of options: Mastodon filters keep their own action, places and expiry.
        const groups = new Map<string, { texts: string[]; options: FilterOptions }>();
        for (const it of items) {
          const options: FilterOptions = { action: it.action, places: it.places, expiresAt: it.expiresAt, exceptFollowing: false };
          const k = JSON.stringify(options);
          if (!groups.has(k)) groups.set(k, { texts: [], options });
          groups.get(k)!.texts.push(it.text);
        }
        return [...groups.values()];
      }
    } catch { /* not JSON after all: read it as a list */ }
  }
  const texts = parseFilterList(t);
  return texts.length ? [{ texts, options: fallback }] : [];
}

/** Saves the filters as Mastodon's JSON export, which Mastodon 5.0 (and Atlas) can import. */
export function downloadExport(filters: ContentFilter[]) {
  const blob = new Blob([JSON.stringify(toMastodonExport(filters), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'atlas-keyword-filters.json';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
