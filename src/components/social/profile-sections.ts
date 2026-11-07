/** Profile tabs, after Bluesky's profile: Posts, Replies, Media, the owner-only Saved tab, then Feeds and Lists. */
export const profileSections = ['Posts', 'Replies', 'Media', 'Saved', 'Feeds', 'Lists'] as const;
export type ProfileSection = (typeof profileSections)[number];
