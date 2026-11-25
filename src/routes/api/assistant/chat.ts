import { createFileRoute } from "@tanstack/react-router";

/**
 * The signed-in person's current assistant conversation (src/lib/assistant/*).
 * GET: whether answers are kept (`durable`), the chat's id, its finished messages and whether an answer is being
 * written right now (`answering`: the browser then reconnects to it). DELETE: "New chat" — stops a running answer and
 * forgets the conversation. Without a stream server, GET says `durable: false` and the assistant works as before.
 */
const NO_STORE = { "cache-control": "private, no-store" };

export const Route = createFileRoute("/api/assistant/chat")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { durableConfig } = await import("@/lib/assistant/durable.server");
        if (!durableConfig()) return Response.json({ durable: false }, { headers: NO_STORE });
        const { userIdFromRequest } = await import("@/lib/intelligence/session.server");
        const userId = await userIdFromRequest(request);
        if (!userId) return Response.json({ durable: false }, { headers: NO_STORE });
        const { readChat } = await import("@/lib/assistant/chat-store.server");
        try {
          const chat = await readChat(userId);
          return Response.json(
            chat
              ? { durable: true, id: chat.chatId, messages: chat.messages, answering: !!chat.activeStream }
              : { durable: true, id: crypto.randomUUID(), messages: [], answering: false },
            { headers: NO_STORE },
          );
        } catch {
          // The table isn't there or Supabase is down: answer the old way rather than not at all.
          return Response.json({ durable: false }, { headers: NO_STORE });
        }
      },
      DELETE: async ({ request }) => {
        const { userIdFromRequest } = await import("@/lib/intelligence/session.server");
        const userId = await userIdFromRequest(request);
        if (!userId) return new Response("Sign in to use the assistant", { status: 401 });
        const { readChat, clearChat } = await import("@/lib/assistant/chat-store.server");
        const { stopAnswer } = await import("@/lib/assistant/durable.server");
        try {
          const chat = await readChat(userId);
          stopAnswer(chat?.activeStream);
          await clearChat(userId);
        } catch {
          return new Response("Couldn't start a new chat", { status: 503 });
        }
        return new Response(null, { status: 204, headers: NO_STORE });
      },
    },
  },
});
