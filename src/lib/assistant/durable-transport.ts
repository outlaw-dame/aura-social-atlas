/**
 * The assistant's transport when answers are kept on Durable Streams (src/lib/assistant/durable.server.ts).
 *
 * After @durable-streams/aisdk-transport 0.0.8's createDurableChatTransport (same contract: POST answers with Location
 * and { streamUrl }; the reconnect endpoint answers 204 when nothing is running), written here so Atlas can send the
 * person's Supabase token on every read: the stream is read through Atlas's own route, which checks who's asking.
 * The answer is read with live SSE in JSON mode, one AI SDK chunk per message, from the start of the stream, so a
 * reconnect replays the answer so far (the AI SDK's default for resumed streams).
 */
import { stream } from '@durable-streams/client';
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';

export type AuthHeaders = () => Promise<Record<string, string>>;

async function failure(response: Response): Promise<Error> {
  const text = await response.text().catch(() => '');
  return new Error(text.slice(0, 300) || `The assistant answered ${response.status}`);
}

async function streamUrlOf(response: Response): Promise<string | null> {
  const location = response.headers.get('location');
  if (location) return location;
  try {
    const body = (await response.json()) as { streamUrl?: unknown };
    return typeof body.streamUrl === 'string' && body.streamUrl ? body.streamUrl : null;
  } catch {
    return null;
  }
}

/** Only Atlas's own read route: a URL from anywhere else is refused, so a token is never sent elsewhere. */
export function sameOriginStreamUrl(url: string, base: string): string {
  const resolved = new URL(url, base);
  if (resolved.origin !== new URL(base).origin || !resolved.pathname.startsWith('/api/assistant/stream/')) {
    throw new Error('Unexpected assistant stream address');
  }
  return resolved.toString();
}

async function readAnswer(url: string, headers: AuthHeaders, signal?: AbortSignal): Promise<ReadableStream<UIMessageChunk>> {
  const res = await stream<UIMessageChunk>({
    url: sameOriginStreamUrl(url, window.location.href),
    live: 'sse',
    json: true,
    signal,
    // Read again before each request, so a refreshed sign-in token is used on long answers.
    headers: { Authorization: async () => (await headers()).Authorization ?? '' },
  });
  const it = res.jsonStream()[Symbol.asyncIterator]();
  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      const next = await it.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel() { await it.return?.(); },
  });
}

export function durableChatTransport<M extends UIMessage = UIMessage>(headers: AuthHeaders): ChatTransport<M> {
  return {
    async sendMessages({ chatId, messages, trigger, messageId, abortSignal, body }) {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await headers()) },
        body: JSON.stringify({ ...(body ?? {}), id: chatId, messages, trigger, messageId, durable: true }),
        signal: abortSignal,
      });
      if (!response.ok) throw await failure(response);
      const url = await streamUrlOf(response);
      if (!url) throw new Error('The assistant didn’t say where its answer is');
      return readAnswer(url, headers, abortSignal);
    },
    async reconnectToStream({ chatId }) {
      const response = await fetch(`/api/assistant/resume?id=${encodeURIComponent(chatId)}`, { headers: await headers() });
      if (response.status === 204) return null;
      if (!response.ok) throw await failure(response);
      const url = await streamUrlOf(response);
      return url ? readAnswer(url, headers) : null;
    },
  };
}
