import architecture from '@/assets/news-architecture.jpg';
import space from '@/assets/news-space.jpg';
import design from '@/assets/news-design.jpg';
import travel from '@/assets/news-travel.jpg';

export const networks = ['All networks', 'Bluesky', 'Mastodon', 'RSS'] as const;
export const topics = ['All topics', 'Design', 'Science', 'Culture', 'Travel'] as const;

/** Mastodon-style profile field: key/value metadata, optionally a verified link (rel="me"). */
export type ProfileField = { name: string; value: string; url?: string; verified?: boolean };
/** Mastodon-style featured hashtag with usage count. */
export type FeaturedTag = { name: string; count: number };

export type Creator = {
  id: string; name: string; handle: string; domain: string; network: string; topic: string; bio: string;
  initials: string; url: string; avatar_key: string; followers: string; joined: string;
  follows_you?: boolean; bot?: boolean;
  fields: ProfileField[]; featured_hashtags: FeaturedTag[];
};

export const creators: Creator[] = [
  {
    id: 'studio', name: 'The Material Studio', handle: '@materialstudio', domain: 'bsky.social', network: 'Bluesky', topic: 'Design',
    bio: 'Objects, spaces, and the people who make them. Weekly notes on #design and #interiors from the workshop.',
    initials: 'MS', url: 'https://bsky.app/', avatar_key: 'memoji-1', followers: '12.4K', joined: 'March 2023', follows_you: true,
    fields: [
      { name: 'Website', value: 'materialstudio.example', url: 'https://bsky.app/', verified: true },
      { name: 'Location', value: 'Copenhagen, DK' },
    ],
    featured_hashtags: [{ name: 'design', count: 142 }, { name: 'interiors', count: 87 }],
  },
  {
    id: 'orbit', name: 'Notes from Orbit', handle: '@notesfromorbit', domain: 'mastodon.social', network: 'Mastodon', topic: 'Science',
    bio: 'A little perspective from beyond our planet. Dispatches on #space and #science, written slowly.',
    initials: 'NO', url: 'https://mastodon.social/', avatar_key: 'memoji-2', followers: '48.1K', joined: 'November 2020',
    fields: [
      { name: 'Website', value: 'notesfromorbit.space', url: 'https://mastodon.social/', verified: true },
      { name: 'Pronouns', value: 'they/them' },
    ],
    featured_hashtags: [{ name: 'space', count: 312 }, { name: 'science', count: 204 }],
  },
  {
    id: 'form', name: 'A Softer Form', handle: 'asofterform.example', domain: 'rss', network: 'RSS', topic: 'Culture',
    bio: 'Architecture and everyday life, observed slowly. Essays on #architecture and #slowliving.',
    initials: 'SF', url: 'https://www.architecturaldigest.com/', avatar_key: 'memoji-3', followers: '9.2K', joined: 'June 2021',
    fields: [
      { name: 'Website', value: 'asofterform.example', url: 'https://www.architecturaldigest.com/', verified: true },
    ],
    featured_hashtags: [{ name: 'architecture', count: 96 }, { name: 'slowliving', count: 41 }],
  },
  {
    id: 'elsewhere', name: 'Elsewhere Journal', handle: '@elsewherejournal', domain: 'bsky.social', network: 'Bluesky', topic: 'Travel',
    bio: 'Small discoveries from the road less traveled. Postcards about #travel and quiet #coastlines.',
    initials: 'EJ', url: 'https://bsky.app/', avatar_key: 'memoji-4', followers: '21.7K', joined: 'January 2024', bot: true,
    fields: [
      { name: 'Newsletter', value: 'elsewherejournal.substack.com', url: 'https://bsky.app/', verified: true },
      { name: 'Based in', value: 'Lisbon, PT' },
    ],
    featured_hashtags: [{ name: 'travel', count: 178 }, { name: 'coastlines', count: 63 }],
  },
];

export const posts = [
  { id: 'glass', creatorId: 'form', title: 'A softer way to see the city', excerpt: 'Looking at the buildings that make light feel like a material of its own.', image: architecture, url: 'https://www.architecturaldigest.com/', kind: 'Essay', alt: 'Modern glass architecture', pinned: true },
  { id: 'objects', creatorId: 'studio', title: 'Objects that invite you to slow down', excerpt: 'A study in texture, thoughtful details, and the beauty of everyday things.', image: design, url: 'https://www.dezeen.com/', kind: 'Photo story', alt: 'Thoughtfully designed interior objects', pinned: true },
  { id: 'stars', creatorId: 'orbit', title: 'There is always more beyond the horizon', excerpt: 'A new perspective on the stars, and our small place among them.', image: space, url: 'https://www.nasa.gov/', kind: 'Dispatch', alt: 'Stars and a celestial landscape', pinned: true },
  { id: 'coast', creatorId: 'elsewhere', title: 'Postcards from a quieter coastline', excerpt: 'Empty harbors, soft mornings, and a different rhythm of travel.', image: travel, url: 'https://www.cntraveler.com/', kind: 'Journal', alt: 'Mediterranean coastal scenery', pinned: true },
];

/** Full fediverse address, e.g. @notesfromorbit@mastodon.social. */
export function fullHandle(creator: Creator): string {
  const name = creator.handle.startsWith('@') ? creator.handle : `@${creator.handle}`;
  return creator.domain === 'rss' ? creator.handle : `${name}@${creator.domain}`;
}

export function matchesCreator(creator: Creator, query: string, network: string, topic: string) {
  return (network === 'All networks' || creator.network === network)
    && (topic === 'All topics' || creator.topic === topic)
    && `${creator.name} ${creator.handle} ${creator.bio} ${creator.topic}`.toLowerCase().includes(query.trim().toLowerCase());
}
