/**
 * Profile tabs, after Mastodon's 2026 profile redesign and Bluesky: Activity (one tab for posts, quote posts,
 * replies and boosts, filtered like Mastodon's Activity dropdown), Featured (Mastodon 4.4: featured hashtags and
 * featured profiles), Media, Collections (Mastodon 4.6), the owner-only Saved tab, then Circles (Bonfire's circles of people) and Lists.
 */
export const profileSections = ['Activity', 'Featured', 'Media', 'Collections', 'Saved', 'Circles', 'Lists'] as const;
export type ProfileSection = (typeof profileSections)[number];

/** Old tab names still open the right tab (?tab=posts, ?tab=replies, ?tab=feeds). */
const aliases: Record<string, ProfileSection> = { posts: 'Activity', replies: 'Activity', feeds: 'Circles' };
export function sectionFromTab<T extends string>(tab: string | undefined, sections: readonly T[]): T | undefined {
  const t = tab?.trim().toLowerCase();
  if (!t) return undefined;
  return sections.find(s => s.toLowerCase() === t) ?? (sections.includes(aliases[t] as T) ? aliases[t] as T : undefined);
}

/** Activity always shows posts and quote posts; replies and boosts are switched on or off, as on Mastodon. */
export type ActivityFilter = { replies: boolean; boosts: boolean };
export const DEFAULT_ACTIVITY_FILTER: ActivityFilter = { replies: false, boosts: true };

/** "Your posts, quote posts and boosts" — what the Activity tab is showing, in words. */
export function activityLabel(f: ActivityFilter): string {
  const parts = ['posts', 'quote posts', ...(f.replies ? ['replies'] : []), ...(f.boosts ? ['boosts'] : [])];
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
