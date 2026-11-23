import { createFileRoute } from '@tanstack/react-router';
import { Discovery } from '@/components/social/Discovery';

export const Route = createFileRoute('/settings/import')({
  head: () => ({ meta: [
    { title: 'Import — Atlas Settings' },
    { name: 'description', content: 'Bring follows, blocks, mutes, lists and filters from Mastodon or Bonfire.' },
    { property: 'og:title', content: 'Import — Atlas Settings' },
    { property: 'og:description', content: 'Bring follows, blocks, mutes, lists and filters from Mastodon or Bonfire.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary' },
  ] }),
  component: () => <Discovery view="import" />,
});
