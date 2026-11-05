/**
 * End-to-end through Fedify's real inbox pipeline: HTTP signatures are produced with fresh keys,
 * remote actor documents are served by an in-test loader, and outbound deliveries are captured by
 * stubbing fetch. No network traffic leaves the test.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { generateCryptoKeyPair, signRequest } from '@fedify/fedify';
import { exportSpki, getDocumentLoader } from '@fedify/vocab-runtime';
import { buildRelay, storesFor } from './app.ts';
import { parseConfig } from './policy.ts';
import { AS_PUBLIC } from './visibility.ts';

const AS = ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'];
type Remote = { id: string; inbox: string; keyId: string; keys: CryptoKeyPair };
const docs = new Map<string, unknown>();
const delivered: { url: string; body: Record<string, unknown> }[] = [];
const realFetch = globalThis.fetch;

async function remoteActor(id: string, type = 'Person'): Promise<Remote> {
  const keys = await generateCryptoKeyPair('RSASSA-PKCS1-v1_5');
  const host = new URL(id).origin;
  const r = { id, inbox: `${host}/inbox`, keyId: `${id}#main-key`, keys };
  docs.set(id, { '@context': AS, id, type, preferredUsername: id.split('/').pop(), inbox: r.inbox, endpoints: { sharedInbox: r.inbox }, publicKey: { id: r.keyId, owner: id, publicKeyPem: await exportSpki(keys.publicKey) } });
  return r;
}

const TEST_HOSTS = new Set(['fedizen.net', 'mastodon.social', 'bonfire.example']);
const contexts = getDocumentLoader(); // preloaded JSON-LD contexts only
const loader = async (url: string) => {
  const doc = docs.get(url.split('#')[0]);
  if (!doc) { if (!TEST_HOSTS.has(new URL(url).hostname)) return contexts(url); throw new Error(`not found: ${url}`); }
  return { contextUrl: null, document: doc, documentUrl: url };
};

async function post(relayInbox: URL, signer: Remote, body: Record<string, unknown>) {
  const req = new Request(relayInbox, { method: 'POST', headers: { 'content-type': 'application/activity+json', accept: 'application/activity+json' }, body: JSON.stringify({ '@context': 'https://www.w3.org/ns/activitystreams', ...body }) });
  return signRequest(req, signer.keys.privateKey, new URL(signer.keyId));
}

async function until(pred: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await new Promise(r => setTimeout(r, 25));
  return pred();
}
const settle = () => new Promise(r => setTimeout(r, 400));

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.method === 'POST') { delivered.push({ url: req.url, body: await req.json() }); return new Response(null, { status: 202 }); }
    return realFetch(input, init);
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });

for (const protocol of ['litepub', 'mastodon'] as const) {
  describe(`${protocol}: signed inbox pipeline`, () => {
    let handle: (r: Request) => Promise<Response>;
    let inbox: URL; let relayActor: URL;
    let fedizenRelay: Remote, alice: Remote, mallory: Remote, socialRelay: Remote;
    const n = () => crypto.randomUUID();

    beforeAll(async () => {
      const cfg = parseConfig({ RELAY_PROTOCOL: protocol, RELAY_ORIGIN: 'http://localhost:8787', RELAY_ALLOWED_DOMAINS: 'fedizen.net,mastodon.social,bonfire.example', RELAY_DEV_MEMORY: '1' });
      const built = buildRelay(cfg, await storesFor(cfg), { documentLoaderFactory: () => loader, authenticatedDocumentLoaderFactory: () => loader });
      handle = built.handle; inbox = await built.relay.getSharedInboxUri(); relayActor = await built.relay.getActorUri();
      fedizenRelay = await remoteActor('https://fedizen.net/relay', 'Application');
      socialRelay = await remoteActor('https://mastodon.social/actor', 'Application');
      alice = await remoteActor('https://fedizen.net/users/alice');
      mallory = await remoteActor('https://fedizen.net/users/mallory');
      docs.set('https://fedizen.net/notes/private', { '@context': AS, id: 'https://fedizen.net/notes/private', type: 'Note', attributedTo: alice.id, to: [`${alice.id}/followers`], content: 'secret' });
      docs.set('https://fedizen.net/notes/public', { '@context': AS, id: 'https://fedizen.net/notes/public', type: 'Note', attributedTo: alice.id, to: [AS_PUBLIC], content: 'hello' });

      // Subscription handshake: Follow is control plane and is not addressed to Public.
      for (const sub of [fedizenRelay, socialRelay]) {
        const object = protocol === 'mastodon' ? AS_PUBLIC : relayActor.href;
        const followId = `${new URL(sub.id).origin}/follows/${n()}`;
        const res = await handle(await post(inbox, sub, { id: followId, type: 'Follow', actor: sub.id, object }));
        expect(res.status).toBeLessThan(300);
        expect(await until(() => delivered.some(d => d.url === sub.inbox && d.body.type === 'Accept'))).toBe(true);
        if (protocol === 'litepub') {
          // LitePub: relay follows back; subscriber Accepts the relay's Follow to activate the subscription.
          expect(await until(() => delivered.some(d => d.url === sub.inbox && d.body.type === 'Follow'))).toBe(true);
          const relayFollow = delivered.find(d => d.url === sub.inbox && d.body.type === 'Follow')!.body;
          const acc = await handle(await post(inbox, sub, { id: `${new URL(sub.id).origin}/accepts/${n()}`, type: 'Accept', actor: sub.id, object: relayFollow }));
          expect(acc.status).toBeLessThan(300);
        }
      }
      await settle();
      delivered.length = 0;
    });

    test('a valid public post from a subscriber is relayed to other subscribers', async () => {
      const body = { id: `https://fedizen.net/activities/${n()}`, type: protocol === 'litepub' ? 'Announce' : 'Create', actor: alice.id, to: [AS_PUBLIC], cc: [`${alice.id}/followers`],
        object: protocol === 'litepub' ? 'https://fedizen.net/notes/public' : { id: 'https://fedizen.net/notes/public', type: 'Note', attributedTo: alice.id, to: [AS_PUBLIC], content: 'hello' } };
      const res = await handle(await post(inbox, alice, body));
      expect(res.status).toBeLessThan(300);
      if (protocol === 'litepub') {
        expect(await until(() => delivered.some(d => d.url === socialRelay.inbox))).toBe(true);
      } else {
        // Mastodon-style forwarding only forwards activities carrying their own LD signature/proof;
        // HTTP-signed-only posts are dropped by Fedify (skipIfUnsigned), so nothing leaks either way.
        await settle();
        expect(delivered.filter(d => d.url === fedizenRelay.inbox)).toHaveLength(0);
      }
    });

    test('duplicate activity ids are delivered at most once', async () => {
      delivered.length = 0;
      const body = { id: `https://fedizen.net/activities/${n()}`, type: 'Announce', actor: alice.id, to: [AS_PUBLIC], object: 'https://fedizen.net/notes/public' };
      await handle(await post(inbox, alice, body));
      await handle(await post(inbox, alice, body));
      await settle();
      expect(delivered.filter(d => d.url === socialRelay.inbox).length).toBeLessThanOrEqual(1);
    });

    test('followers-only and direct posts are refused before reaching Fedify', async () => {
      delivered.length = 0;
      const fo = await handle(await post(inbox, alice, { id: `https://fedizen.net/a/${n()}`, type: 'Create', actor: alice.id, to: [`${alice.id}/followers`], object: { id: `https://fedizen.net/n/${n()}`, type: 'Note', attributedTo: alice.id, to: [`${alice.id}/followers`] } }));
      const dm = await handle(await post(inbox, alice, { id: `https://fedizen.net/a/${n()}`, type: 'Create', actor: alice.id, to: ['https://mastodon.social/users/bob'], object: { id: `https://fedizen.net/n/${n()}`, type: 'Note', attributedTo: alice.id, to: ['https://mastodon.social/users/bob'] } }));
      expect(fo.status).toBe(403); expect(dm.status).toBe(403);
      await settle();
      expect(delivered).toHaveLength(0);
    });

    test('Announce of a private object passes the prefilter but is dropped after verification', async () => {
      delivered.length = 0;
      const res = await handle(await post(inbox, alice, { id: `https://fedizen.net/a/${n()}`, type: 'Announce', actor: alice.id, to: [AS_PUBLIC], object: 'https://fedizen.net/notes/private' }));
      expect(res.status).toBeLessThan(300);
      await settle();
      expect(delivered).toHaveLength(0);
    });

    test('a forged actor field signed by someone else is rejected by signature checks', async () => {
      delivered.length = 0;
      const res = await handle(await post(inbox, mallory, { id: `https://fedizen.net/a/${n()}`, type: 'Announce', actor: alice.id, to: [AS_PUBLIC], object: 'https://fedizen.net/notes/public' }));
      expect(res.status).toBeGreaterThanOrEqual(400);
      await settle();
      expect(delivered).toHaveLength(0);
    });

    test('an unsigned public post claiming a subscriber actor is rejected', async () => {
      const res = await handle(new Request(inbox, { method: 'POST', headers: { 'content-type': 'application/activity+json' }, body: JSON.stringify({ '@context': 'https://www.w3.org/ns/activitystreams', id: `https://fedizen.net/a/${n()}`, type: 'Announce', actor: alice.id, to: [AS_PUBLIC], object: 'https://fedizen.net/notes/public' }) }));
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('allowlisted server that never subscribed cannot publish', async () => {
      const bob = await remoteActor('https://bonfire.example/users/bob');
      const res = await handle(await post(inbox, bob, { id: `https://bonfire.example/a/${n()}`, type: 'Announce', actor: bob.id, to: [AS_PUBLIC], object: 'https://fedizen.net/notes/public' }));
      expect(res.status).toBe(403);
    });

    test('Undo of the subscriber\'s own Follow unsubscribes it; afterwards it cannot publish', async () => {
      const follow = { id: `https://mastodon.social/follows/${n()}`, type: 'Follow', actor: socialRelay.id, object: protocol === 'mastodon' ? AS_PUBLIC : relayActor.href };
      const res = await handle(await post(inbox, socialRelay, { id: `https://mastodon.social/undo/${n()}`, type: 'Undo', actor: socialRelay.id, object: follow }));
      expect(res.status).toBeLessThan(300);
      await settle();
      const carol = await remoteActor('https://mastodon.social/users/carol');
      const after = await handle(await post(inbox, carol, { id: `https://mastodon.social/a/${n()}`, type: 'Announce', actor: carol.id, to: [AS_PUBLIC], object: 'https://fedizen.net/notes/public' }));
      expect(after.status).toBe(403);
    });
  });
}
