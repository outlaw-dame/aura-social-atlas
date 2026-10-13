import architecture from '@/assets/news-architecture.jpg';
import space from '@/assets/news-space.jpg';
import design from '@/assets/news-design.jpg';
import travel from '@/assets/news-travel.jpg';

export const networks = ['All networks', 'Bluesky', 'Mastodon', 'RSS'] as const;
export const topics = ['All topics', 'Design', 'Science', 'Culture', 'Travel'] as const;
export type Creator = { id: string; name: string; handle: string; network: string; topic: string; bio: string; initials: string; url: string };
export const creators: Creator[] = [
  { id: 'studio', name: 'The Material Studio', handle: '@materialstudio', network: 'Bluesky', topic: 'Design', bio: 'Objects, spaces, and the people who make them.', initials: 'MS', url: 'https://bsky.app/' },
  { id: 'orbit', name: 'Notes from Orbit', handle: '@notesfromorbit', network: 'Mastodon', topic: 'Science', bio: 'A little perspective from beyond our planet.', initials: 'NO', url: 'https://mastodon.social/' },
  { id: 'form', name: 'A Softer Form', handle: 'asofterform.example', network: 'RSS', topic: 'Culture', bio: 'Architecture and everyday life, observed slowly.', initials: 'SF', url: 'https://www.architecturaldigest.com/' },
  { id: 'elsewhere', name: 'Elsewhere Journal', handle: '@elsewherejournal', network: 'Bluesky', topic: 'Travel', bio: 'Small discoveries from the road less traveled.', initials: 'EJ', url: 'https://bsky.app/' },
];
export const posts = [
  { id: 'glass', creatorId: 'form', title: 'A softer way to see the city', excerpt: 'Looking at the buildings that make light feel like a material of its own.', image: architecture, url: 'https://www.architecturaldigest.com/', kind: 'Essay', alt: 'Modern glass architecture' },
  { id: 'objects', creatorId: 'studio', title: 'Objects that invite you to slow down', excerpt: 'A study in texture, thoughtful details, and the beauty of everyday things.', image: design, url: 'https://www.dezeen.com/', kind: 'Photo story', alt: 'Thoughtfully designed interior objects' },
  { id: 'stars', creatorId: 'orbit', title: 'There is always more beyond the horizon', excerpt: 'A new perspective on the stars, and our small place among them.', image: space, url: 'https://www.nasa.gov/', kind: 'Dispatch', alt: 'Stars and a celestial landscape' },
  { id: 'coast', creatorId: 'elsewhere', title: 'Postcards from a quieter coastline', excerpt: 'Empty harbors, soft mornings, and a different rhythm of travel.', image: travel, url: 'https://www.cntraveler.com/', kind: 'Journal', alt: 'Mediterranean coastal scenery' },
];
export function matchesCreator(creator: Creator, query: string, network: string, topic: string) {
  return (network === 'All networks' || creator.network === network)
    && (topic === 'All topics' || creator.topic === topic)
    && `${creator.name} ${creator.handle} ${creator.bio} ${creator.topic}`.toLowerCase().includes(query.trim().toLowerCase());
}
