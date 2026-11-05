import { describe, test } from 'node:test';
import { ok, strictEqual } from 'node:assert';
import { buildRelay, readLimited, storesFor } from './app.ts';
import { parseConfig } from './policy.ts';

for (const protocol of ['mastodon', 'litepub'] as const) {
  describe(`${protocol} relay`, async () => {
    const cfg = parseConfig({ RELAY_PROTOCOL: protocol, RELAY_ORIGIN: 'http://localhost:8787', RELAY_ALLOWED_DOMAINS: 'fedizen.net', RELAY_DEV_MEMORY: '1' });
    const { relay, handle } = buildRelay(cfg, await storesFor(cfg));

    test('serves its actor as ActivityPub JSON at the library-derived URL', async () => {
      const actor = await relay.getActorUri();
      const res = await handle(new Request(actor, { headers: { accept: 'application/activity+json' } }));
      strictEqual(res.status, 200);
      ok((res.headers.get('content-type') ?? '').includes('json'));
      const j = await res.json() as { id: string; inbox: string };
      strictEqual(j.id, actor.href);
    });

    test('health reveals only ok status', async () => {
      const j = await (await handle(new Request('http://localhost:8787/healthz'))).json() as Record<string, unknown>;
      strictEqual(JSON.stringify(j), '{"ok":true}');
    });

    test('rejects oversized bodies with 413', async () => {
      const inbox = await relay.getSharedInboxUri();
      const res = await handle(new Request(inbox, { method: 'POST', body: 'x'.repeat(cfg.maxBodyBytes + 1) }));
      strictEqual(res.status, 413);
    });

    test('blocks inbound activities from non-allowlisted servers', async () => {
      const inbox = await relay.getSharedInboxUri();
      const res = await handle(new Request(inbox, { method: 'POST', headers: { 'content-type': 'application/activity+json' }, body: JSON.stringify({ type: 'Follow', actor: 'https://spam.example/u', object: 'https://www.w3.org/ns/activitystreams#Public' }) }));
      strictEqual(res.status, 403);
    });

    test('unsigned activity from an allowlisted host is not accepted', async () => {
      const inbox = await relay.getSharedInboxUri();
      const res = await handle(new Request(inbox, { method: 'POST', headers: { 'content-type': 'application/activity+json' }, body: JSON.stringify({ id: 'https://fedizen.net/a/1', type: 'Follow', actor: 'https://fedizen.net/pub/actors/x', object: 'https://www.w3.org/ns/activitystreams#Public' }) }));
      ok(res.status >= 400, `expected rejection, got ${res.status}`);
    });
  });
}

test('readLimited stops streaming once the limit is passed', async () => {
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(c) { pulls++; c.enqueue(new Uint8Array(1024)); if (pulls > 100) c.close(); } });
  const r = await readLimited(new Request('http://localhost/', { method: 'POST', body: stream, duplex: 'half' } as RequestInit), 4096);
  strictEqual(r, null); ok(pulls < 10, `pulled ${pulls}`);
});

test('readLimited preserves bytes exactly', async () => {
  const bytes = new Uint8Array([0x7b, 0xc3, 0xa9, 0x7d]);
  const r = await readLimited(new Request('http://localhost/', { method: 'POST', body: bytes }), 100);
  strictEqual(Buffer.from(r!).toString('hex'), '7bc3a97d');
});
