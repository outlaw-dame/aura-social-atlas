import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";

type ChatRequestBody = { messages?: unknown; id?: unknown; durable?: unknown };

const SYSTEM_PROMPT = `You are Atlas, a warm and concise AI assistant built into the Atlas browser — a beautiful native-feeling browser inspired by iOS 27 Liquid Glass.

You help the user:
- Answer questions clearly and briefly (markdown allowed; keep it tight).
- Navigate the browser by calling the navigate_to tool when they ask to go to a website, open something, or search.
- Search the web by calling the navigate_to tool with a Google search URL when they want to look something up.
- Summarize news, explain concepts, and offer thoughtful follow-ups.

When the user asks to "go to", "open", "visit", or "search for" something, ALWAYS call navigate_to. Build a full https URL when given a bare domain. For searches, use https://www.google.com/search?q=ENCODED_QUERY.

Keep responses short, friendly, and human. Never mention which model powers you.`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Signed-in only, with the person's own key (Settings → Intelligence); Atlas's own AI credit is never used.
        const { userIdFromRequest } = await import("@/lib/intelligence/session.server");
        const userId = await userIdFromRequest(request);
        if (!userId) return new Response("Sign in to use the assistant", { status: 401 });

        const { messages, id, durable } = (await request.json()) as ChatRequestBody;
        if (!Array.isArray(messages) || messages.length > 100) {
          return new Response("Messages are required", { status: 400 });
        }

        const { assistantModel } = await import("@/lib/intelligence/store.server");
        const ai = await assistantModel(userId);
        if ("problem" in ai) {
          return new Response(ai.problem === "not-ready" ? "Turn on Intelligence and add an API key in Settings" : "The AI service isn't available right now", { status: 409 });
        }
        const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
        const { openAiBase } = await import("@/lib/intelligence/llm");
        // Every provider here takes OpenAI-style chat with streaming and tools; for Anthropic that's its OpenAI SDK
        // compatibility layer. The base URL is fixed per provider, so the key only goes to its own provider.
        const provider = createOpenAICompatible({ name: ai.credential.provider, baseURL: openAiBase(ai.credential), apiKey: ai.credential.key });
        const model = provider.chatModel(ai.model);

        // Durable answers (src/lib/assistant/durable.server.ts): asked for by the browser only when /api/assistant/chat
        // said this server has a stream server. The answer is written to a stream the browser reads, so it survives a
        // refresh or another device; without one, the answer streams back on this response as before.
        const durableMod = durable === true ? await import("@/lib/assistant/durable.server") : null;
        const cfg = durableMod?.durableConfig() ?? null;
        if (durable === true && !cfg) return new Response("The assistant can't keep answers right now", { status: 503 });
        const store = cfg ? await import("@/lib/assistant/chat-store.server") : null;
        if (store && !store.isUuid(id)) return new Response("A chat id is required", { status: 400 });
        const streamId = cfg ? crypto.randomUUID() : null;
        if (store && streamId) {
          try { await store.startAnswer(userId, id as string, messages, streamId); }
          catch { return new Response("The assistant can't keep answers right now", { status: 503 }); }
        }
        const abortSignal = durableMod && streamId ? durableMod.trackAnswer(streamId) : undefined;

        const { noteFailure } = await import("@/lib/intelligence/store.server");
        const result = streamText({
          model,
          abortSignal,
          // A key the provider is limiting rests a minute, so the next request starts with the person's backup key.
          onError: ({ error }) => noteFailure(ai.keyId, error),
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages as UIMessage[]),
          stopWhen: stepCountIs(50),
          tools: {
            navigate_to: tool({
              description:
                "Navigate the browser to a specific URL or perform a web search. Use this whenever the user asks to open, visit, go to, or search for something.",
              inputSchema: z.object({
                url: z
                  .string()
                  .describe(
                    "Full https URL to load in the browser viewport. For searches, pass a https://www.google.com/search?q=... URL."
                  ),
                reason: z
                  .string()
                  .describe("Short human-friendly explanation, e.g. 'Opening GitHub' or 'Searching for React docs'."),
              }),
              execute: async ({ url, reason }) => {
                return { url, reason, ok: true };
              },
            }),
          },
        });

        if (durableMod && cfg && store && streamId) {
          const chatId = id as string;
          const settle = () => { durableMod.untrackAnswer(streamId); return store.finishAnswer(userId, chatId, streamId, null); };
          const source = result.toUIMessageStream({
            originalMessages: messages as UIMessage[],
            // The answer is kept and replayed, so it needs a lasting id of its own (else every device makes its own).
            generateMessageId: () => crypto.randomUUID(),
            onFinish: ({ messages: finished }) => store.finishAnswer(userId, chatId, streamId, finished),
          });
          let done: Promise<void>;
          try {
            ({ done } = await durableMod.writeAnswer(cfg, streamId, source));
          } catch {
            durableMod.stopAnswer(streamId);
            await settle();
            return new Response("The assistant can't keep answers right now", { status: 503 });
          }
          // The answer goes on being written after this response; the browser reads it from the stream.
          void done.catch(() => console.warn("Assistant answer not fully written")).finally(settle);
          const streamUrl = durableMod.readPathFor(streamId);
          return Response.json({ streamUrl }, { status: 201, headers: { Location: streamUrl, "cache-control": "no-store" } });
        }

        return result.toUIMessageStreamResponse({
          originalMessages: messages as UIMessage[],
        });
      },
    },
  },
});
