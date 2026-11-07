import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { Discovery } from '@/components/social/Discovery';
import { profileSections } from '@/components/social/profile-sections';

const search = z.object({ tab: z.string().optional().catch(undefined) });
export const Route = createFileRoute('/profile')({
 validateSearch: search,
 head: () => ({ meta: [
 { title: 'Your profile — Atlas' },
 { name: 'description', content: 'Your Atlas profile, saved stories and the voices you follow.' },
 { name: 'robots', content: 'noindex' },
 ] }),
 component: Page,
});
function Page() {
  const { tab } = Route.useSearch();
  const section = profileSections.find(s => s.toLowerCase() === tab?.toLowerCase());
  return <Discovery view="profile" profileSection={section} />;
}
