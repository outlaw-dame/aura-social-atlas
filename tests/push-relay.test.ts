import { afterEach, describe, expect, test } from 'bun:test';
import { b64u, decryptPush, encryptPush, newKeyPair, unb64u, vapidHeader } from '../src/lib/push/webpush';

/* A small in-memory stand-in for the Supabase tables the relay uses. */
const tables: Record<string, Record<string, unknown>[]> = { atlas_push_relays: [], atlas_push_devices: [] };
function q(table: string) {
  const filters: [string, unknown][] = [];
  let op: 'select' | 'delete' | 'update' = 'select', patch: Record<string, unknown> = {}, head = false;
  const rows = () => tables[table].filter(r => filters.every(([k, v]) => r[k] === v));
  const api = {
    select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return api; },
    eq: (k: string, v: unknown) => { filters.push([k, v]); return api; },
    limit: () => api,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    upsert: async (row: Record<string, unknown>, o?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
      const key = o?.onConflict ?? 'user_id';
      const i = tables[table].findIndex(r => r[key] === row[key]);
      if (i >= 0) {
        if (!o?.ignoreDuplicates) tables[table][i] = { ...tables[table][i], ...row };
      } else tables[table].push({ id: crypto.randomUUID(), ...row });
      return { error: null };
    },
    insert: async (row: Record<string, unknown>) => {
      // Simulate Postgres's UNIQUE(endpoint) race protection, not owner-clobbering upsert.
      if (table === 'atlas_push_devices' && tables[table].some(r => r.endpoint === row.endpoint)) {
        return { error: { code: '23505' } };
      }
      tables[table].push({ id: crypto.randomUUID(), ...row });
      return { error: null };
    },
    delete: () => { op = 'delete'; return api; },
    update: (p: Record<string, unknown>) => { op = 'update'; patch = p; return api; },
    then: (resolve: (v: unknown) => void) => {
      if (op === 'delete') { tables[table] = tables[table].filter(r => !filters.every(([k, v]) => r[k] === v)); return resolve({ error: null }); }
      if (op === 'update') { rows().forEach(r => Object.assign(r, patch)); return resolve({ error: null }); }
      return resolve(head ? { count: rows().length, error: null } : { data: rows(), error: null });
    },
  };
  return api;
}
const sends: { method: string; path: string; body?: Record<string, unknown> }[] = [];
let fedizenServerKey = '';

const atlas = await newKeyPair(), fedizen = await newKeyPair();
process.env['ATLAS_VAPID_PUBLIC_KEY'] = b64u(atlas.pub);
process.env['ATLAS_VAPID_PRIVATE_KEY'] = b64u(atlas.d);
process.env['ATLAS_VAPID_SUBJECT'] = 'mailto:push@atlas.example';
fedizenServerKey = b64u(fedizen.pub);
const relayMod = await import('../src/lib/push/relay.server');
relayMod.relayDeps.db = (async () => ({ from: q })) as never;
relayMod.relayDeps.send = (async (_t: string, method: string, path: string, body?: Record<string, unknown>) => { sends.push({ method, path, body }); return { status: 200, data: method === 'POST' ? { server_key: fedizenServerKey } : null }; }) as never;

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe('Push relay', () => {
  const browser = { keys: null as null | Awaited<ReturnType<typeof newKeyPair>>, auth: crypto.getRandomValues(new Uint8Array(16)) };
  test('a browser on a known push service is added, and Fedizen is told to push to the relay', async () => {
    browser.keys = await newKeyPair();
    const bad = await relayMod.addDevice('u1', 'tok', 'https://atlas.example', { endpoint: 'https://evil.example/hook', p256dh: b64u(browser.keys.pub), auth: b64u(browser.auth) });
    expect(bad).toEqual({ ok: false, error: 'bad-subscription' });
    const r = await relayMod.addDevice('u1', 'tok', 'https://atlas.example', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: b64u(browser.keys.pub), auth: b64u(browser.auth) });
    expect(r).toEqual({ ok: true });
    const sub = sends.at(-1)!;
    expect(sub.method).toBe('POST');
    expect(sub.path).toBe('/api/v1/push/subscription');
    const endpoint = (sub.body!.subscription as { endpoint: string }).endpoint;
    expect(endpoint).toMatch(/^https:\/\/atlas\.example\/api\/push\/relay\/[A-Za-z0-9_-]{32}$/);
    expect(tables.atlas_push_relays[0].server_key).toBe(fedizenServerKey);
    expect(JSON.stringify(tables.atlas_push_relays[0])).not.toContain(b64u(atlas.d)); // the relay's private key is sealed
  });

  test('rejects reuse of another user’s endpoint without changing device ownership or contacting Fedizen', async () => {
    const sameEndpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    const owner = tables.atlas_push_devices.find(r => r.endpoint === sameEndpoint);
    expect(owner?.user_id).toBe('u1');
    const before = sends.length;
    const response = await relayMod.addDevice('u2', 'different-token', 'https://atlas.example',
      { endpoint: sameEndpoint, p256dh: b64u(browser.keys!.pub), auth: b64u(browser.auth) });
    expect(response).toEqual({ ok: false, error: 'bad-subscription' });
    expect(sends).toHaveLength(before);
    expect(tables.atlas_push_devices.find(r => r.endpoint === sameEndpoint)?.user_id).toBe('u1');
  });

  test('refreshes a device for its existing owner without reassigning the unique endpoint', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    const originalId = tables.atlas_push_devices.find(r => r.endpoint === endpoint)?.id;
    const result = await relayMod.addDevice('u1', 'tok', 'https://atlas.example',
      { endpoint, p256dh: b64u(browser.keys!.pub), auth: b64u(browser.auth) });
    expect(result).toEqual({ ok: true });
    expect(tables.atlas_push_devices.filter(r => r.endpoint === endpoint)).toHaveLength(1);
    expect(tables.atlas_push_devices.find(r => r.endpoint === endpoint)).toMatchObject({ id: originalId, user_id: 'u1' });
  });

  test("Fedizen's push is checked, decrypted, stripped of its token and passed to the browser", async () => {
    const relay = tables.atlas_push_relays[0] as { relay_id: string; public_key: string; auth_secret: string };
    const url = `https://atlas.example/api/push/relay/${relay.relay_id}`;
    const payload = { access_token: 'FEDIZEN-SECRET-TOKEN', notification_id: '01X', notification_type: 'mention', title: 'Ann mentioned you', body: '@you hello there', icon: 'https://fedizen.net/a.png', preferred_locale: 'en' };
    const body = await encryptPush(new TextEncoder().encode(JSON.stringify(payload)), unb64u(relay.public_key), unb64u(relay.auth_secret));
    const delivered: { url: string; headers: Headers; body: Uint8Array }[] = [];
    globalThis.fetch = (async (u: string, init: RequestInit) => { delivered.push({ url: String(u), headers: new Headers(init.headers), body: new Uint8Array(init.body as ArrayBuffer) }); return new Response(null, { status: 201 }); }) as unknown as typeof fetch;
    const req = (auth: string | null) => new Request(url, { method: 'POST', headers: { 'content-encoding': 'aes128gcm', ...(auth ? { authorization: auth } : {}) }, body });

    expect((await relayMod.relay(relay.relay_id, req(null))).status).toBe(401);
    const forged = await newKeyPair();
    expect((await relayMod.relay(relay.relay_id, req(await vapidHeader(url, 'mailto:x@y.z', forged.d, forged.pub)))).status).toBe(401);
    expect((await relayMod.relay('unknownrelayid000000000000', req(null))).status).toBe(404);

    const ok = await relayMod.relay(relay.relay_id, req(await vapidHeader(url, 'mailto:admin@fedizen.net', fedizen.d, fedizen.pub)));
    expect(ok.status).toBe(201);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].url).toBe('https://fcm.googleapis.com/fcm/send/abc');
    expect(delivered[0].headers.get('authorization')).toContain(`k=${b64u(atlas.pub)}`);
    const plain = JSON.parse(new TextDecoder().decode(await decryptPush(delivered[0].body, browser.keys!.d, browser.keys!.pub, browser.auth)));
    expect(plain).toEqual({ title: 'Ann mentioned you', body: '@you hello there', kind: 'mention' });
    expect(JSON.stringify(plain)).not.toContain('FEDIZEN-SECRET-TOKEN');
  });

  test('a browser that went away is forgotten; the last one leaving ends the Fedizen subscription', async () => {
    const relay = tables.atlas_push_relays[0] as { relay_id: string; public_key: string; auth_secret: string };
    const url = `https://atlas.example/api/push/relay/${relay.relay_id}`;
    globalThis.fetch = (async () => new Response(null, { status: 410 })) as unknown as typeof fetch;
    const body = await encryptPush(new TextEncoder().encode(JSON.stringify({ title: 'x', body: 'y', notification_type: 'follow' })), unb64u(relay.public_key), unb64u(relay.auth_secret));
    await relayMod.relay(relay.relay_id, new Request(url, { method: 'POST', headers: { 'content-encoding': 'aes128gcm', authorization: await vapidHeader(url, 'mailto:a@b.c', fedizen.d, fedizen.pub) }, body }));
    expect(tables.atlas_push_devices).toHaveLength(0);
    await relayMod.removeDevice('u1', 'tok', null);
    expect(sends.at(-1)).toMatchObject({ method: 'DELETE', path: '/api/v1/push/subscription' });
    expect(tables.atlas_push_relays).toHaveLength(0);
  });

  test('two simultaneous device enrollments share one canonical relay ID', async () => {
    const keys = await newKeyPair();
    const auth = b64u(crypto.getRandomValues(new Uint8Array(16)));
    const firstEndpoint = 'https://fcm.googleapis.com/fcm/send/parallel-1';
    const secondEndpoint = 'https://fcm.googleapis.com/fcm/send/parallel-2';
    const before = sends.length;
    const [first, second] = await Promise.all([
      relayMod.addDevice('u3', 'token-u3', 'https://atlas.example',
        { endpoint: firstEndpoint, p256dh: b64u(keys.pub), auth }),
      relayMod.addDevice('u3', 'token-u3', 'https://atlas.example',
        { endpoint: secondEndpoint, p256dh: b64u(keys.pub), auth }),
    ]);
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(tables.atlas_push_relays.filter(row => row.user_id === 'u3')).toHaveLength(1);
    expect(tables.atlas_push_devices.filter(row => row.user_id === 'u3')).toHaveLength(2);
    const concurrentSubs = sends.slice(before).filter(send => send.path === '/api/v1/push/subscription');
    expect(concurrentSubs).toHaveLength(2);
    const urls = concurrentSubs.map(send => (send.body!.subscription as { endpoint: string }).endpoint);
    expect(new Set(urls).size).toBe(1);
    expect(urls[0]).toContain((tables.atlas_push_relays.find(row => row.user_id === 'u3') as { relay_id: string }).relay_id);
  });

  test('only title, body and kind reach a browser', () => {
    expect(relayMod.safeNotice({ access_token: 't', title: ' A ', body: 'B', notification_type: 'nonsense' })).toEqual({ title: 'A', body: 'B', kind: 'other' });
    expect(relayMod.safeNotice({ access_token: 't' })).toBeNull();
  });
});
