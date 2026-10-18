import { createFileRoute } from '@tanstack/react-router';
import { Discovery } from '@/components/social/Discovery';

export const Route = createFileRoute('/settings/')({
  head: () => ({ meta: [
    { title: 'Settings — Atlas Open Social Web' },
    { name: 'description', content: 'Manage your Atlas intelligence and appearance preferences.' },
    { property: 'og:title', content: 'Settings — Atlas Open Social Web' },
    { property: 'og:description', content: 'Manage your Atlas intelligence and appearance preferences.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary' },
  ] }),
  component: () => <Discovery view="settings" />,
});