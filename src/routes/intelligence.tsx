import { createFileRoute, redirect } from '@tanstack/react-router';
export const Route = createFileRoute('/intelligence')({
 head: () => ({ meta: [
 { title: 'Intelligence — Atlas settings' },
 { name: 'description', content: 'Choose whether to turn on the optional Atlas AI assistant for exploring the open social web.' },
 { property: 'og:title', content: 'Intelligence — Atlas settings' },
 { property: 'og:description', content: 'Choose whether to turn on the optional Atlas AI assistant for exploring the open social web.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary' },
 ] }),
 beforeLoad: () => { throw redirect({ to: '/settings/intelligence' }); },
});
