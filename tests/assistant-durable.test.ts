import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { durableConfig, proxyRead, readPathFor, streamUrlFor, STREAM_TTL_SECONDS } from '../src/lib/assistant/durable.server';
import { chatStoreDeps, finishAnswer, isUuid, KEEP_MS, mayRead, readChat, type StoredChat } from '../src/lib/assistant/chat-store.server';
import { sameOriginStreamUrl } from '../src/lib/assistant/durable-transport';
import { keepOrReplace, sessionFrom } from '../src/lib/assistant/useAssistantSession';

const TOKEN = 'a'.repeat(40);
const cfg = durableConfig({ ATLAS_DURABLE_STREAMS_URL: 'http://atlas-streams.railway.internal:4437/v1/stream/', ATLAS_DURABLE_STREAMS_TOKEN: TOKEN })!;
const ID = '3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b';

describe('the stream server is used only when properly configured', () => {
  test('needs a URL and a token of 32+ characters; otherwise the assistant answers the old way', () => {
    expect(cfg).toEqual({ base: 'http://atlas-streams.railway.internal:4437/v1/stream', token: TOKEN });
    expect(durableConfig({})).toBeNull();
    expect(durableConfig({ ATLAS_DURABLE_STREAMS_URL: 'http://x/v1/stream', ATLAS_DURABLE_STREAMS_TOKEN: 'short' })).toBeNull();
    expect(durableConfig({ ATLAS_DURABLE_STREAMS_URL: 'ftp://x/v1/stream', ATLAS_DURABLE_STREAMS_TOKEN: TOKEN })).toBeNull();
    expect(durableConfig({ ATLAS_DURABLE_STREAMS_URL: 'http://u:p@x/v1/stream', ATLAS_DURABLE_STREAMS_TOKEN: TOKEN })).toBeNull();
    expect(durableConfig({ ATLAS_DURABLE_STREAMS_URL: 'not a url', ATLAS_DURABLE_STREAMS_TOKEN: TOKEN })).toBeNull();
    expect(streamUrlFor(cfg, ID)).toBe(`http://atlas-streams.railway.internal:4437/v1/stream/assistant/${ID}`);
    expect(readPathFor(ID)).toBe(`/api/assistant/stream/${ID}`);
    expect(STREAM_TTL_SECONDS).toBe(86_400);
  });
});

describe('reading an answer goes through Atlas, never straight to the stream server', () => {
  const capture = () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('[{"type":"text-delta"}]', {
        status: 200,
        headers: { 'content-type': 'application/json', 'stream-next-offset': '0000_0001', 'stream-up-to-date': 'true', 'stream-closed': 'true', etag: '"e"', 'set-cookie': 'leak=1', 'x-internal': 'no' },
      });
    }) as typeof fetch;
    return { calls, fetchImpl };
  };

  test('only the protocol read parameters pass; the token is added on the server side', async () => {
    const { calls, fetchImpl } = capture();
    const req = new Request(`https://atlas.test/api/assistant/stream/${ID}?offset=-1&live=sse&cursor=9&evil=1`, { headers: { authorization: 'Bearer person-token' } });
    const res = await proxyRead(cfg, ID, req, fetchImpl);
    const sent = new URL(calls[0].url);
    expect(sent.pathname).toBe(`/v1/stream/assistant/${ID}`);
    expect([...sent.searchParams.keys()].sort()).toEqual(['cursor', 'live', 'offset']);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].init.redirect).toBe('manual');
    // Only the stream's own headers come back, never cached.
    expect(res.headers.get('stream-next-offset')).toBe('0000_0001');
    expect(res.headers.get('stream-closed')).toBe('true');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('x-internal')).toBeNull();
  });

  test('an unknown live mode is refused; a refusal by the stream server is not passed on as the reader’s fault', async () => {
    const { fetchImpl } = capture();
    expect((await proxyRead(cfg, ID, new Request(`https://atlas.test/x?live=websocket`), fetchImpl)).status).toBe(400);
    const refused = (async () => new Response('no', { status: 401 })) as unknown as typeof fetch;
    expect((await proxyRead(cfg, ID, new Request('https://atlas.test/x'), refused)).status).toBe(502);
    const moved = (async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } })) as unknown as typeof fetch;
    const res = await proxyRead(cfg, ID, new Request('https://atlas.test/x'), moved);
    expect(res.status).toBe(502);
    expect(res.headers.get('location')).toBeNull();
  });

  test("the browser reads only Atlas's own stream route, so its sign-in token can't be sent elsewhere", () => {
    expect(sameOriginStreamUrl(`/api/assistant/stream/${ID}`, 'https://atlas.test/app')).toBe(`https://atlas.test/api/assistant/stream/${ID}`);
    expect(() => sameOriginStreamUrl(`https://evil.test/api/assistant/stream/${ID}`, 'https://atlas.test/app')).toThrow();
    expect(() => sameOriginStreamUrl('/api/chat', 'https://atlas.test/app')).toThrow();
    expect(() => sameOriginStreamUrl('//evil.test/api/assistant/stream/x', 'https://atlas.test/app')).toThrow();
  });
});

describe("each person reads only their own chat's answers", () => {
  const chat: StoredChat = { chatId: ID, messages: [], activeStream: '11111111-1111-4111-8111-111111111111', lastStream: '22222222-2222-4222-8222-222222222222', updatedAt: 0 };
  test('the running answer and the last one, nothing else', () => {
    expect(mayRead(chat, '11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(mayRead(chat, '22222222-2222-4222-8222-222222222222')).toBe(true);
    expect(mayRead(chat, '33333333-3333-4333-8333-333333333333')).toBe(false);
    expect(mayRead(null, '11111111-1111-4111-8111-111111111111')).toBe(false);
    expect(mayRead({ ...chat, activeStream: '../x' }, '../x')).toBe(false);
    expect(isUuid(ID)).toBe(true);
    expect(isUuid('x')).toBe(false);
  });
});

describe('the conversation is kept a day', () => {
  function fakeDb(row: Record<string, unknown> | null) {
    const ops: string[] = [];
    const chain = (op: string) => {
      const q: Record<string, unknown> = {};
      const filters: string[] = [];
      q.select = () => q;
      q.eq = (k: string, v: unknown) => { filters.push(`${k}=${v}`); return q; };
      q.maybeSingle = async () => ({ data: row, error: null });
      q.then = (res: (v: unknown) => void) => { ops.push(`${op} ${filters.join('&')}`); res({ error: null }); };
      return q;
    };
    return {
      ops,
      db: { from: () => ({ select: () => chain('select'), delete: () => chain('delete'), update: (patch: unknown) => { const c = chain(`update ${JSON.stringify(patch)}`); return c; } }) },
    };
  }

  test('a chat over a day old is gone, and deleted', async () => {
    const old = new Date(0).toISOString();
    const { db, ops } = fakeDb({ chat_id: ID, messages: [], active_stream: null, last_stream: null, updated_at: old });
    chatStoreDeps.db = async () => db as never;
    chatStoreDeps.now = () => KEEP_MS + 1;
    expect(await readChat('u1')).toBeNull();
    expect(ops.some(o => o.startsWith('delete user_id=u1'))).toBe(true);
  });

  test('a fresh chat is returned as stored', async () => {
    const { db } = fakeDb({ chat_id: ID, messages: [{ id: 'm' }], active_stream: 's', last_stream: 's', updated_at: new Date(1000).toISOString() });
    chatStoreDeps.db = async () => db as never;
    chatStoreDeps.now = () => 2000;
    expect(await readChat('u1')).toEqual({ chatId: ID, messages: [{ id: 'm' }], activeStream: 's', lastStream: 's', updatedAt: 1000 });
  });

  test('an answer that ends only clears "answering" if it is still the latest', async () => {
    const { db, ops } = fakeDb(null);
    chatStoreDeps.db = async () => db as never;
    await finishAnswer('u1', ID, 's1', null);
    expect(ops[0]).toContain(`user_id=u1&chat_id=${ID}&active_stream=s1`);
    expect(ops[0]).toContain('"active_stream":null');
    expect(ops[0]).not.toContain('"messages"');
  });
});

describe('the browser trusts only a well-formed answer from /api/assistant/chat', () => {
  test('durable only with an id and messages; anything else answers the old way', () => {
    const s = sessionFrom({ durable: true, id: ID, messages: [{ id: 'm', role: 'user', parts: [] }], answering: true });
    expect(s).toMatchObject({ durable: true, id: ID, ready: true, answering: true });
    expect(sessionFrom({ durable: false })).toMatchObject({ durable: false, ready: true });
    expect(sessionFrom({ durable: true, id: 5, messages: [] }).durable).toBe(false);
    expect(sessionFrom(null).durable).toBe(false);
  });

  test('reopening while answers still aren’t kept leaves the chat on screen alone', () => {
    const shown = { key: 'k1', ready: true, durable: false, messages: [], answering: false };
    expect(keepOrReplace(shown, { ...shown, key: 'k2' })).toBe(shown);
    const kept = sessionFrom({ durable: true, id: ID, messages: [] });
    expect(keepOrReplace(shown, kept)).toBe(kept);
    const loading = { ...shown, key: 'loading', ready: false };
    expect(keepOrReplace(loading, shown)).toBe(shown);
  });
});

describe('wiring', () => {
  const chatRoute = readFileSync('src/routes/api/chat.ts', 'utf8');
  test('/api/chat keeps answers only when the browser asks and the server can; the answer is written after it replies', () => {
    expect(chatRoute).toMatch(/const durableMod = durable === true \? await import\("@\/lib\/assistant\/durable\.server"\) : null;/);
    expect(chatRoute).toMatch(/if \(store && !store\.isUuid\(id\)\) return new Response\("A chat id is required", \{ status: 400 \}\);/);
    expect(chatRoute).toMatch(/onFinish: \(\{ messages: finished \}\) => store\.finishAnswer\(userId, chatId, streamId, finished\)/);
    expect(chatRoute).toMatch(/status: 201, headers: \{ Location: streamUrl/);
    // Without a stream server, exactly as before.
    expect(chatRoute).toMatch(/return result\.toUIMessageStreamResponse\(\{\s*originalMessages: messages as UIMessage\[\],\s*\}\);/);
  });

  test('resuming finds the running answer, else the last one (it may have finished meanwhile)', () => {
    expect(readFileSync('src/routes/api/assistant/resume.ts', 'utf8')).toMatch(/const stream = chat && chat\.chatId === id \? chat\.activeStream \?\? chat\.lastStream : null;/);
  });

  test('reading a stream checks who is asking and that it is their chat', () => {
    const proxy = readFileSync('src/routes/api/assistant/stream.$streamId.ts', 'utf8');
    expect(proxy).toMatch(/const userId = await userIdFromRequest\(request\);\s*if \(!userId\) return new Response/);
    expect(proxy).toMatch(/if \(!mayRead\(chat, params\.streamId\)\) return new Response\("Not found", \{ status: 404/);
  });

  test('pages open only from answers to questions asked in this view, never from a replayed one', () => {
    for (const f of ['src/components/social/Assistant.tsx', 'src/components/f7/F7Extras.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src).toMatch(/if \(actFrom\.current === null\) return;/);
      expect(src).toMatch(/messages\.slice\(actFrom\.current\)/);
      expect(src).toMatch(/resume: session\.durable && session\.answering/);
    }
  });

  test('the stream server is private and needs the token', () => {
    const caddy = readFileSync('infra/durable-streams/Caddyfile', 'utf8');
    expect(caddy).toMatch(/@unauthorized not header Authorization "Bearer \{\$DS_TOKEN\}"\s*respond @unauthorized 401\s*durable_streams/);
    expect(readFileSync('infra/durable-streams/start.sh', 'utf8')).toMatch(/if \[ "\$\{#DS_TOKEN\}" -lt 32 \]/);
    expect(readFileSync('infra/durable-streams/Dockerfile', 'utf8')).toMatch(/ARG DS_COMMIT=0483b435d30b6a60759df5ee2fe21983c7d65eba/);
  });
});
