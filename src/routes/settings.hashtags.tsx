import { createFileRoute } from '@tanstack/react-router';
import { Discovery } from '@/components/social/Discovery';

export const Route = createFileRoute('/settings/hashtags')({
  head: () => ({ meta: [
    { title: 'Followed hashtags — Atlas Settings' },
    { name: 'description', content: 'The hashtags you follow on Fedizen.' },
    { property: 'og:title', content: 'Followed hashtags — Atlas Settings' },
    { property: 'og:description', content: 'The hashtags you follow on Fedizen.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary' },
  ] }),
  component: () => <Discovery view="hashtags" />,
});
