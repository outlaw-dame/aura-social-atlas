import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Feeds and their older pages stay in memory for 30 min after leaving them (React Query keeps 5 min by default), so
  // coming back to a feed, a profile or a conversation within that time doesn't read it all again. A failed read is
  // retried once, not three times: pages say what went wrong sooner (Bluesky's app doesn't retry at all by default,
  // src/lib/react-query.tsx, "we want to fail early and show a response to the user").
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 30 * 60_000, retry: 1 } } });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
