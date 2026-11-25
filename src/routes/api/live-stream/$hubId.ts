import { createFileRoute } from "@tanstack/react-router";

/**
 * Reading the person's live hub (Durable Streams read protocol: offset, live=sse|long-poll, cursor), only their own and
 * only while it's open; anything else is 404, and the browser asks /api/live-stream/session for a new one.
 */
export const Route = createFileRoute("/api/live-stream/$hubId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { durableConfig, proxyStream } = await import("@/lib/assistant/durable.server");
        const cfg = durableConfig();
        if (!cfg) return new Response("Not found", { status: 404 });
        const { userIdFromRequest } = await import("@/lib/intelligence/session.server");
        const userId = await userIdFromRequest(request);
        if (!userId) return new Response("Sign in to Atlas", { status: 401 });
        const { touchHub, hubPath } = await import("@/lib/live-hub.server");
        if (!touchHub(userId, params.hubId)) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
        try {
          return await proxyStream(cfg, hubPath(params.hubId), request);
        } catch {
          return new Response("Live updates are unavailable", { status: 502, headers: { "cache-control": "no-store" } });
        }
      },
    },
  },
});
