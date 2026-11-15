import { createFileRoute } from '@tanstack/react-router';
import { Discovery } from '@/components/social/Discovery';

export const Route = createFileRoute('/settings/moderation')({
  head: () => ({ meta: [
    { title: 'Moderation — Atlas Settings' },
    { name: 'description', content: 'Keyword filters, blocked people and blocked instances for your Fedizen account.' },
    { property: 'og:title', content: 'Moderation — Atlas Settings' },
    { property: 'og:description', content: 'Keyword filters, blocked people and blocked instances for your Fedizen account.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary' },
  ] }),
  component: () => <Discovery view="moderation" />,
});
