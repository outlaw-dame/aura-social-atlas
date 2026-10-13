import { createFileRoute } from '@tanstack/react-router';
import { Discovery } from '@/components/social/Discovery';
export const Route = createFileRoute('/saved')({
 head: () => ({ meta: [
 { title: 'Saved — Your Atlas reading list' },
 { name: 'description', content: 'Revisit the stories and ideas you have saved while exploring the open social web on Atlas.' },
 { property: 'og:title', content: 'Saved — Your Atlas reading list' },
 { property: 'og:description', content: 'Revisit the stories and ideas you have saved while exploring the open social web on Atlas.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }),
 component: Page,
});
function Page() { return <Discovery view="saved" />; }
