/**
 * The Device Lab's page: Atlas's phone app (/app), with the same providers as the site's root route
 * (src/routes/__root.tsx), on sample data. Simulation runs first so the app reads the Lab's device.
 */
// Imported for its effect, and named so the bundler keeps it (package.json declares no side effects).
import { simulated } from './sim';
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { AtlasAuthProvider } from '@/components/social/AuthState';
import { SocialProvider } from '@/components/social/SocialState';
import { ContentFilterProvider } from '@/components/social/useIntelligence';
import { OPEN_POST_EVENT, type OpenPostDetail } from '@/lib/open-post';
import { labLive } from './live';
import { ISS } from './data/posts';
import { labSignIn } from './stubs/supabase';
import { startReporting } from './report';
import '@/styles.css';

// Requests the app makes to Atlas's own API (the live stream, push) stay open and quiet here: the Lab plays live
// events itself (live.ts). Anything else is refused, as the artifact host refuses other sites.
document.documentElement.dataset.labDevice = simulated ? 'simulated' : 'this-device';
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('/api/live')) return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  if (url.startsWith('/') || url.startsWith(location.origin)) return realFetch(input, init);
  return Promise.reject(new TypeError(`The Device Lab doesn’t reach other sites (${new URL(url, location.href).host}).`));
};

const AtlasMobileApp = lazy(() => import('@/components/f7/AtlasMobileApp'));
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

function Lab() {
  return (
    <QueryClientProvider client={queryClient}>
      <AtlasAuthProvider>
        <SocialProvider><ContentFilterProvider>
          <Suspense fallback={<div className="min-h-dvh bg-background" aria-busy="true" />}><AtlasMobileApp /></Suspense>
        </ContentFilterProvider></SocialProvider>
      </AtlasAuthProvider>
    </QueryClientProvider>
  );
}

// The desktop components the phone app reuses on wide screens link with TanStack Router: a router in memory keeps
// them working. Every path renders the app, as /app does.
const rootRoute = createRootRoute({ component: Lab, notFoundComponent: () => null });
const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/app'] }) });

createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
// Once Framework7 has started, tell the bench what the app made of the device.
const started = setInterval(() => { if (document.querySelector('.atlas-tabbar')) { clearInterval(started); startReporting(); } }, 100);

// The Lab bench drives the demo: live updates in the open conversation, and signing back in.
window.addEventListener('message', e => {
  const d = e.data as { type?: string; action?: string } | null;
  if (e.source !== window.parent || d?.type !== 'atlas-lab') return;
  if (d.action === 'reply') labLive.addReply();
  else if (d.action === 'edit') labLive.editReply();
  else if (d.action === 'delete') labLive.deleteReply();
  else if (d.action === 'sign-in') labSignIn();
  else if (d.action === 'conversation') window.dispatchEvent(new CustomEvent<OpenPostDetail>(OPEN_POST_EVENT, { detail: { statusId: ISS.id, seed: ISS } }));
});
