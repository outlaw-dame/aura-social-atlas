import { createFileRoute } from "@tanstack/react-router";

/**
 * Reconnecting to an answer (the AI SDK's resume): where to read this person's chat `id`'s running or last answer
 * (Location and { streamUrl }), as @durable-streams/aisdk-transport's reconnect endpoint does; 204 when there's none.
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
        // The running answer, else the last one: an answer can finish between the browser learning it was running and
        // asking here, and the browser's copy of the chat doesn't have it yet. Replaying it shows it (the AI SDK treats
        // a resumed stream as a replay of the latest answer).
        const stream = chat && chat.chatId === id ? chat.activeStream ?? chat.lastStream : null;
        if (!stream) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
        const streamUrl = readPathFor(stream);
        return Response.json({ streamUrl }, { headers: { Location: streamUrl, "cache-control": "private, no-store" } });
      },
    },
  },
});
