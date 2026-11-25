import { createFileRoute } from "@tanstack/react-router";

/**
 * The signed-in person's live hub (src/lib/live-hub.server.ts): its id and where to read it. 404 when this server
 * keeps no streams; the browser then uses /api/live as before.
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
        const { hubFor } = await import("@/lib/live-hub.server");
        return Response.json(hubFor(cfg, userId), { headers: { "cache-control": "private, no-store" } });
      },
    },
  },
});
