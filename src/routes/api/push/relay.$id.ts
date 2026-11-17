import { createFileRoute } from "@tanstack/react-router";

/** Where Fedizen pushes notifications for one person (src/lib/push/relay.server.ts): checked, decrypted, passed on. */
export const Route = createFileRoute("/api/push/relay/$id")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { relay } = await import("@/lib/push/relay.server");
        return relay(params.id, request);
      },
    },
  },
});
