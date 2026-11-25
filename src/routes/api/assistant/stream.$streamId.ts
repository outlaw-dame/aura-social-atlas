import { createFileRoute } from "@tanstack/react-router";

/**
 * Reading an answer as it's written (src/lib/assistant/durable.server.ts): the Durable Streams read protocol (offset,
 * live=sse|long-poll, cursor), passed to Atlas's private stream server after checking that the stream is the signed-in
 * person's own chat's running or last answer. Anyone else gets 404, the same as a stream that doesn't exist.
 */
export const Route = createFileRoute("/api/assistant/stream/$streamId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { durableConfig, proxyRead } = await import("@/lib/assistant/durable.server");
        const cfg = durableConfig();
        if (!cfg) return new Response("Not found", { status: 404 });
        const { userIdFromRequest } = await import("@/lib/intelligence/session.server");
        const userId = await userIdFromRequest(request);
        if (!userId) return new Response("Sign in to use the assistant", { status: 401 });
        const { readChat, mayRead } = await import("@/lib/assistant/chat-store.server");
        const chat = await readChat(userId).catch(() => null);
        if (!mayRead(chat, params.streamId)) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
        try {
          return await proxyRead(cfg, params.streamId, request);
        } catch {
          return new Response("The assistant is unavailable", { status: 502, headers: { "cache-control": "no-store" } });
        }
      },
    },
  },
});
