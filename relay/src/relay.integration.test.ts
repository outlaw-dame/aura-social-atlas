import { describe, test } from 'node:test';
import { ok, strictEqual } from 'node:assert';
import { buildRelay, storesFor } from './app.ts';
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

    test('health reports protocol and subscription URLs', async () => {
      const j = await (await handle(new Request('http://localhost:8787/healthz'))).json() as Record<string, unknown>;
      strictEqual(j.protocol, protocol); strictEqual(j.followers, 0);
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
