/**
 * Live updates from Fedizen, as Atlas's own small set of events. Browser-safe and pure; live.server.ts feeds it.
 *
 * Fedizen (Bonfire) streams two ways (bonfire_notify):
 * - Mastodon's WebSocket streaming API at /api/v1/streaming (MastoStreamingWebSocket): frames
 *   {"stream":["user"],"event":"update"|"notification"|"delete"|"status.update"|…,"payload":"<JSON string>"};
 * - Server-Sent Events at the same path for plain HTTP (StreamingController): `notification` {title, body, url, icon},
 *   `message` {thread_id} and `unseen_count` {count}.
 * Atlas sends the browser only what it acts on, never anything that could carry the Fedizen token: a new or edited post
 * (normalised server-side like any timeline read), a deleted post id, that a notification or message arrived, and the
 * unread count.
 */
export type LiveEvent =
  | { type: 'post'; status: unknown; edited?: boolean }
  | { type: 'delete'; id: string }
  | { type: 'notification'; kind?: string }
  | { type: 'message' }
  | { type: 'unseen'; count: number };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** One Mastodon streaming frame → an event (the post still to be checked against the timeline schema). */
export function fromMastoFrame(text: string): LiveEvent | null {
  let f: { event?: unknown; payload?: unknown };
  try { f = JSON.parse(text) as typeof f; } catch { return null; }
  if (!f || typeof f.event !== 'string') return null;
  const payload = typeof f.payload === 'string' ? f.payload : '';
  const json = () => { try { return JSON.parse(payload) as unknown; } catch { return null; } };
  switch (f.event) {
    case 'update': case 'status.update': { const s = json(); return s && typeof s === 'object' ? { type: 'post', status: s, ...(f.event === 'status.update' ? { edited: true } : {}) } : null; }
    case 'delete': return ID.test(payload) ? { type: 'delete', id: payload } : null;
    case 'notification': { const n = json() as { type?: unknown } | null; return { type: 'notification', ...(n && typeof n.type === 'string' && n.type.length < 40 ? { kind: n.type } : {}) }; }
    case 'conversation': return { type: 'message' };
    default: return null;
  }
}

/**
 * Reads Server-Sent Events from text as it arrives: feed it chunks, get complete events back. `rest` is the unfinished
 * tail to prepend to the next chunk.
 */
export function readSse(buffer: string): { events: { event: string; data: string }[]; rest: string } {
  const events: { event: string; data: string }[] = [];
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = parts.pop() ?? '';
  for (const block of parts) {
    let event = 'message'; const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i < 0 ? line : line.slice(0, i), value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'event') event = value; else if (field === 'data') data.push(value);
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return { events, rest: rest.length > 65_536 ? '' : rest };
}

/** One of Bonfire's own SSE events → an event. */
export function fromBonfireSse(e: { event: string; data: string }): LiveEvent | null {
  if (e.event === 'notification') return { type: 'notification' };
  if (e.event === 'message') return { type: 'message' };
  if (e.event === 'unseen_count') {
    try { const c = (JSON.parse(e.data) as { count?: unknown }).count; return typeof c === 'number' && c >= 0 && c < 1e7 ? { type: 'unseen', count: Math.floor(c) } : null; } catch { return null; }
  }
  return null;
}

/** An event as one SSE message to the browser. */
export const toSse = (e: { type: string } & Record<string, unknown>) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
