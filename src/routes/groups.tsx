import { createFileRoute } from '@tanstack/react-router';
import { Discovery } from '@/components/social/Discovery';
export const Route = createFileRoute('/groups')({
 head: () => ({ meta: [
 { title: 'Groups — Atlas' },
 { name: 'description', content: 'Communities you belong to across Fedizen and the open social web.' },
 { property: 'og:title', content: 'Groups — Atlas' },
 { property: 'og:description', content: 'Communities you belong to across Fedizen and the open social web.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary' },
 ] }),
 component: () => <Discovery view="groups" />,
});
