import { createFileRoute } from '@tanstack/react-router';
import { Discovery } from '@/components/social/Discovery';

export const Route = createFileRoute('/settings/notifications')({
  head: () => ({ meta: [
    { title: 'Notifications — Atlas Preferences' },
    { name: 'description', content: 'Get notifications from Fedizen on this device, and choose which.' },
    { property: 'og:title', content: 'Notifications — Atlas Preferences' },
    { property: 'og:description', content: 'Get notifications from Fedizen on this device, and choose which.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary' },
  ] }),
  component: () => <Discovery view="notifications" />,
});