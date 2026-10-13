import { createFileRoute } from '@tanstack/react-router';
import { Discovery } from '@/components/social/Discovery';
export const Route = createFileRoute('/')({
 head: () => ({ meta: [
 { title: 'Atlas — Discover the Open Social Web' },
 { name: 'description', content: 'Explore independent voices, sample creator profiles, and stories across Bluesky, Mastodon, and RSS.' },
 { property: 'og:title', content: 'Atlas — Discover the Open Social Web' },
 { property: 'og:description', content: 'Explore independent voices, sample creator profiles, and stories across Bluesky, Mastodon, and RSS.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }),
 component: Page,
});
function Page() { return <Discovery view="discover" />; }
