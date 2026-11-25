import { createFileRoute } from "@tanstack/react-router";

/**
 * Reconnecting to an answer (the AI SDK's resume): 204 when this person's chat `id` has nothing being written, else
 * where to read it (Location and { streamUrl }), as @durable-streams/aisdk-transport's reconnect endpoint does.
 */
export const Route = createFileRoute("/api/assistant/resume")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { userIdFromRequest } = await import("@/lib/intelligence/session.server");
        const userId = await userIdFromRequest(request);
        if (!userId) return new Response("Sign in to use the assistant", { status: 401 });
        const id = new URL(request.url).searchParams.get("id");
        const { readChat } = await import("@/lib/assistant/chat-store.server");
        const { readPathFor } = await import("@/lib/assistant/durable.server");
        const chat = await readChat(userId).catch(() => null);
        if (!chat || chat.chatId !== id || !chat.activeStream) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
        const streamUrl = readPathFor(chat.activeStream);
        return Response.json({ streamUrl }, { headers: { Location: streamUrl, "cache-control": "private, no-store" } });
      },
    },
  },
});
