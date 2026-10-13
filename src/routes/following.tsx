import { createFileRoute } from '@tanstack/react-router';
import { Discovery } from '@/components/social/Discovery';
export const Route = createFileRoute('/following')({
 head: () => ({ meta: [
 { title: 'Following — Your voices on Atlas' },
 { name: 'description', content: 'A personal feed of the creators and independent voices you choose to follow on Atlas.' },
 { property: 'og:title', content: 'Following — Your voices on Atlas' },
 { property: 'og:description', content: 'A personal feed of the creators and independent voices you choose to follow on Atlas.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }),
 component: Page,
});
function Page() { return <Discovery view="following" />; }
