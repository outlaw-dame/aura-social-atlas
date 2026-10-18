import { createFileRoute } from '@tanstack/react-router';
import { Discovery } from '@/components/social/Discovery';

export const Route = createFileRoute('/settings/intelligence')({
  head: () => ({ meta: [
    { title: 'Intelligence — Atlas Preferences' },
    { name: 'description', content: 'Opt in to the Atlas AI assistant while keeping Compose available without AI.' },
    { property: 'og:title', content: 'Intelligence — Atlas Preferences' },
    { property: 'og:description', content: 'Opt in to the Atlas AI assistant while keeping Compose available without AI.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary' },
  ] }),
  component: () => <Discovery view="intelligence" />,
});