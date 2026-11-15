import { createFileRoute } from '@tanstack/react-router';
import { Discovery } from '@/components/social/Discovery';
export const Route = createFileRoute('/activity')({
 head: () => ({ meta: [
 { title: 'Activity — Atlas' },
 { name: 'description', content: 'Follows, mentions, likes and boosts from your Fedizen account.' },
 { property: 'og:title', content: 'Activity — Atlas' },
 { property: 'og:description', content: 'Follows, mentions, likes and boosts from your Fedizen account.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary' },
 ] }),
 component: () => <Discovery view="activity" />,
});
