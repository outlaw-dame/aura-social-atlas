import { createFileRoute } from '@tanstack/react-router';
import { Discovery } from '@/components/social/Discovery';
export const Route = createFileRoute('/intelligence')({
 head: () => ({ meta: [
 { title: 'Intelligence — Atlas settings' },
 { name: 'description', content: 'Choose whether to turn on the optional Atlas AI assistant for exploring the open social web.' },
 { property: 'og:title', content: 'Intelligence — Atlas settings' },
 { property: 'og:description', content: 'Choose whether to turn on the optional Atlas AI assistant for exploring the open social web.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary' },
 ] }),
 component: Page,
});
function Page() { return <Discovery view="intelligence" />; }
