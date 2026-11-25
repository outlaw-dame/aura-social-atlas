import { createFileRoute } from "@tanstack/react-router";

/**
 * The signed-in person's live hub (src/lib/live-hub.server.ts): its id and where to read it. 404 when this server
 * keeps no streams, 503 when the stream server didn't answer; either way the browser uses /api/live.
 */
export const Route = createFileRoute("/api/live-stream/session")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { durableConfig } = await import("@/lib/assistant/durable.server");
        const cfg = durableConfig();
        if (!cfg) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
        const { userIdFromRequest } = await import("@/lib/intelligence/session.server");
        const userId = await userIdFromRequest(request);
        if (!userId) return new Response("Sign in to Atlas", { status: 401 });
        const { readyHubFor } = await import("@/lib/live-hub.server");
        const hub = await readyHubFor(cfg, userId);
        // The stream server didn't answer: /api/live this time.
        if (!hub) return new Response("Live hub unavailable", { status: 503, headers: { "cache-control": "no-store" } });
        return Response.json(hub, { headers: { "cache-control": "private, no-store" } });
      },
    },
  },
});
