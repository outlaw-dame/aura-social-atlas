import { createFileRoute, ClientOnly } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';

// Framework7 touches the browser at import time, so it loads only on the client.
const AtlasMobileApp = lazy(() => import('@/components/f7/AtlasMobileApp'));

export const Route = createFileRoute('/app')({
  head: () => ({
    meta: [
      { title: 'Atlas App — Open Social Web on your phone' },
      { name: 'description', content: 'The Atlas phone app: discover creators across Bluesky, Mastodon, and RSS with a native iOS or Android feel.' },
      { property: 'og:title', content: 'Atlas App — Open Social Web on your phone' },
      { property: 'og:description', content: 'Discover creators across Bluesky, Mastodon, and RSS with a native iOS or Android feel.' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: AppPage,
});

function AppPage() {
  const fallback = <div className="min-h-dvh bg-background" aria-busy="true" />;
  return (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <AtlasMobileApp />
      </Suspense>
    </ClientOnly>
  );
}
