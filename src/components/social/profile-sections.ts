/** Profile tabs, after Bluesky's profile: Posts, Replies, Media, the owner-only Saved tab, then Circles (Bonfire's circles of people) and Lists. */
export const profileSections = ['Posts', 'Replies', 'Media', 'Saved', 'Circles', 'Lists'] as const;
export type ProfileSection = (typeof profileSections)[number];
