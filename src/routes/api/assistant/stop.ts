import { createFileRoute } from "@tanstack/react-router";

/**
 * Stop: ends the answer being written for the signed-in person's chat. The model is stopped (no more of their key is
 * spent), the stream is closed so every reader sees the end, and what was written is kept as the answer.
 */
export const Route = createFileRoute("/api/assistant/stop")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { userIdFromRequest } = await import("@/lib/intelligence/session.server");
        const userId = await userIdFromRequest(request);
        if (!userId) return new Response("Sign in to use the assistant", { status: 401 });
        const { readChat } = await import("@/lib/assistant/chat-store.server");
        const { stopAnswer } = await import("@/lib/assistant/durable.server");
        const chat = await readChat(userId).catch(() => null);
        stopAnswer(chat?.activeStream);
        return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      },
    },
  },
});
