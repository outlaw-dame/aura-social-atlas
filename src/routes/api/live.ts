import { createFileRoute } from "@tanstack/react-router";

/** Live updates from Fedizen for the signed-in person, as Server-Sent Events (src/lib/live.server.ts). */
export const Route = createFileRoute("/api/live")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { userIdFromRequest } = await import("@/lib/intelligence/session.server");
        const userId = await userIdFromRequest(request);
        if (!userId) return new Response("Sign in to Atlas", { status: 401 });
        const { liveStream } = await import("@/lib/live.server");
        return new Response(liveStream(userId, request.signal), {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store, no-transform",
            "x-accel-buffering": "no",
          },
        });
      },
    },
  },
});
