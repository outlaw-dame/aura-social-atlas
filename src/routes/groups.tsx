import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { Discovery } from '@/components/social/Discovery';

const search = z.object({ group: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional().catch(undefined) });
export const Route = createFileRoute('/groups')({
 validateSearch: search,
 head: () => ({ meta: [
 { title: 'Groups — Atlas' },
 { name: 'description', content: 'Communities on Fedizen and across the fediverse: Bonfire groups, Lemmy and Mbin communities, and more.' },
 { property: 'og:title', content: 'Groups — Atlas' },
 { property: 'og:description', content: 'Communities on Fedizen and across the fediverse: Bonfire groups, Lemmy and Mbin communities, and more.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary' },
 ] }),
 component: Page,
});
function Page() {
  const { group } = Route.useSearch();
  return <Discovery view="groups" groupId={group} />;
}
