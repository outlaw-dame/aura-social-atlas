/**
 * The assistant's answers on Durable Streams (server only). https://github.com/durable-streams/durable-streams
 *
 * While the model answers, every AI SDK chunk is appended to a stream of its own on Atlas's stream server, a separate
 * Railway service reached only over the private network (infra/durable-streams). The browser reads the stream through
 * /api/assistant/stream/$id, which checks who's asking and that the stream is their chat's (chat-store.server.ts), so
 * the stream server itself is never exposed. Because a stream keeps every chunk and readers say where they left off, a
 * refresh, a dropped connection or another device picks the answer up where it is instead of losing it — and the
 * person's AI key isn't spent on asking again.
 *
 * Off unless ATLAS_DURABLE_STREAMS_URL and ATLAS_DURABLE_STREAMS_TOKEN are set; then the assistant works as before.
 * Streams expire STREAM_TTL_SECONDS after their last read or write.
 */
import { DurableStream } from '@durable-streams/client';

export const STREAM_TTL_SECONDS = 24 * 60 * 60;
const CONTENT_TYPE = 'application/json';

export type DurableConfig = { base: string; token: string };

/** The stream server, or null when the assistant should answer the old way. */
export function durableConfig(env: Record<string, string | undefined> = process.env): DurableConfig | null {
  const raw = env['ATLAS_DURABLE_STREAMS_URL']?.trim(), token = env['ATLAS_DURABLE_STREAMS_TOKEN']?.trim();
  if (!raw || !token || token.length < 32) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.search || url.hash || url.username || url.password) return null;
  return { base: url.toString().replace(/\/+$/, ''), token };
}

export const streamUrlFor = (cfg: DurableConfig, streamId: string) => `${cfg.base}/assistant/${streamId}`;
/** Where the browser reads an answer: Atlas's own proxy, never the stream server. */
export const readPathFor = (streamId: string) => `/api/assistant/stream/${streamId}`;

/**
 * Creates the stream (JSON mode: each append is one message) and returns once it exists; the chunks are then written in
 * order as they come and the stream is closed at the end, also on failure, so readers learn it's over. `done` settles
 * when everything is written.
 */
export async function writeAnswer(cfg: DurableConfig, streamId: string, source: AsyncIterable<unknown>): Promise<{ done: Promise<void> }> {
  const stream = new DurableStream({ url: streamUrlFor(cfg, streamId), headers: { Authorization: `Bearer ${cfg.token}` }, contentType: CONTENT_TYPE });
  await stream.create({ contentType: CONTENT_TYPE, ttlSeconds: STREAM_TTL_SECONDS });
  const done = (async () => {
    let failed: unknown;
    let last: Promise<void> = Promise.resolve();
    try {
      for await (const chunk of source) {
        if (failed) break;
        // Appends queue in order inside the client; we only wait for the last one before closing.
        last = stream.append(JSON.stringify(chunk)).catch(e => { failed ??= e; });
      }
    } catch (e) {
      failed ??= e;
    } finally {
      await last;
      await stream.close().catch(() => undefined);
    }
    if (failed) throw failed;
  })();
  return { done };
}

// What the stream server's answer may carry back to the browser.
const PASS_HEADERS = ['content-type', 'stream-next-offset', 'stream-up-to-date', 'stream-cursor', 'stream-closed', 'etag', 'stream-sse-data-encoding'];
const PASS_PARAMS = ['offset', 'live', 'cursor'];

/** Reads `streamId` for the browser: only the protocol's read parameters go through, and only its own headers come back. */
export async function proxyRead(cfg: DurableConfig, streamId: string, request: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const from = new URL(request.url);
  const to = new URL(streamUrlFor(cfg, streamId));
  for (const p of PASS_PARAMS) {
    const v = from.searchParams.get(p);
    if (v !== null && v.length <= 512) to.searchParams.set(p, v);
  }
  const live = to.searchParams.get('live');
  if (live !== null && live !== 'sse' && live !== 'long-poll') return new Response('Bad live mode', { status: 400 });
  const upstream = await fetchImpl(to, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: request.headers.get('accept') ?? '*/*', ...(request.headers.get('if-none-match') ? { 'If-None-Match': request.headers.get('if-none-match')! } : {}) },
    signal: request.signal,
    // Not 'error': Cloudflare's runtime refuses it (tests/fedizen-http.test.ts). A redirect is refused below instead.
    redirect: 'manual',
  });
  const headers = new Headers({ 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex' });
  for (const h of PASS_HEADERS) { const v = upstream.headers.get(h); if (v !== null) headers.set(h, v); }
  if (upstream.status >= 300 && upstream.status < 400) return new Response('The assistant is unavailable', { status: 502, headers });
  if (upstream.status === 401 || upstream.status === 403) {
    console.warn('Assistant stream server refused Atlas', { status: upstream.status });
    return new Response('The assistant is unavailable', { status: 502, headers });
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

/** Answers still being generated on this server instance, so "New chat" can stop one. */
const running = new Map<string, AbortController>();
export function trackAnswer(streamId: string): AbortSignal {
  const c = new AbortController();
  running.set(streamId, c);
  return c.signal;
}
export function untrackAnswer(streamId: string) { running.delete(streamId); }
export function stopAnswer(streamId: string | null | undefined) {
  if (!streamId) return;
  running.get(streamId)?.abort();
  running.delete(streamId);
}
