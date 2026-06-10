import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";

type ChatRequestBody = { messages?: unknown };

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
        const { messages } = (await request.json()) as ChatRequestBody;
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        }

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3-flash-preview");

        const result = streamText({
          model,
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

        return result.toUIMessageStreamResponse({
          originalMessages: messages as UIMessage[],
        });
      },
    },
  },
});
