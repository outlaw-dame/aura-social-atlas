import { createFileRoute } from '@tanstack/react-router';
import { Discovery } from '@/components/social/Discovery';
export const Route = createFileRoute('/messages')({
 head: () => ({ meta: [
 { title: 'Messages — Atlas' },
 { name: 'description', content: 'Your direct messages on Fedizen and across the fediverse.' },
 { property: 'og:title', content: 'Messages — Atlas' },
 { property: 'og:description', content: 'Your direct messages on Fedizen and across the fediverse.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary' },
 ] }),
 component: () => <Discovery view="messages" />,
});
