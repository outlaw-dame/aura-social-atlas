import { createFileRoute } from '@tanstack/react-router';
import { Discovery } from '@/components/social/Discovery';

export const Route = createFileRoute('/settings/appearance')({
  head: () => ({ meta: [
    { title: 'Appearance — Atlas Preferences' },
    { name: 'description', content: 'Choose the light or dark color theme for Atlas social discovery.' },
    { property: 'og:title', content: 'Appearance — Atlas Preferences' },
    { property: 'og:description', content: 'Choose the light or dark color theme for Atlas social discovery.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary' },
  ] }),
  component: () => <Discovery view="appearance" />,
});