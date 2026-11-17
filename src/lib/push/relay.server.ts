/**
 * Push notifications through Atlas's relay (see supabase/migrations/20261117020000_push_relay.sql for why).
 *
 *   browser ──PushManager.subscribe(Atlas VAPID)──▶ Atlas stores the device (atlas_push_devices)
 *   Atlas ──POST /api/v1/push/subscription {endpoint: Atlas relay URL, keys: relay keys}──▶ Fedizen
 *   Fedizen ──Web Push (RFC 8291, its VAPID)──▶ /api/push/relay/<id>  — checked, decrypted, token dropped
 *   Atlas ──Web Push (RFC 8291, Atlas VAPID): {title, body, kind}──▶ each of the person's browsers
 *
 * Mastodon allows one push subscription per access token, and Atlas holds one token per person, so there is one relay
 * per person and it fans out to all their devices. Needs three Worker secrets: ATLAS_VAPID_PUBLIC_KEY and
 * ATLAS_VAPID_PRIVATE_KEY (scripts/vapid-keys.ts makes a pair) and ATLAS_VAPID_SUBJECT (mailto: or https: contact).
 */
import type { Json } from '@/integrations/supabase/types';
import { b64u, decryptPush, encryptPush, newKeyPair, unb64u, vapidHeader, verifyVapid } from './webpush';

/** Storage and Fedizen, swappable in tests. */
export const relayDeps = {
  db: async () => (await import('@/integrations/supabase/client.server')).supabaseAdmin,
  send: async (...a: Parameters<typeof import('../fedizen.server').fedizenSend>) => (await import('../fedizen.server')).fedizenSend(...a),
};
const admin = () => relayDeps.db();
const enc = new TextEncoder();

export type PushAlerts = { mention: boolean; status: boolean; reblog: boolean; follow: boolean; follow_request: boolean; favourite: boolean; poll: boolean; update: boolean; quote: boolean };
export type PushPolicy = 'all' | 'followed' | 'follower' | 'none';
export const DEFAULT_ALERTS: PushAlerts = { mention: true, status: false, reblog: true, follow: true, follow_request: true, favourite: true, poll: true, update: false, quote: true };

type Vapid = { pub: Uint8Array; d: Uint8Array; subject: string };
export type VapidProblem = 'missing' | 'bad-subject' | 'bad-public-key' | 'bad-private-key' | 'keys-do-not-match';

/** A secret as pasted: without spaces, quotes or a leading "NAME=", in base64url (standard base64 accepted too). */
function cleanKey(raw: string, name: string): string {
  let v = raw.trim();
  const unquote = (s: string) =>
    s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
      ? s.slice(1, -1).trim() : s;
  // Accept both a copied value and a copied NAME="value" shell assignment,
  // but do not infer keys from PEM/JWK or arbitrary mixed text.
  v = unquote(v);
  if (v.startsWith(`${name}=`)) v = v.slice(name.length + 1).trim();
  v = unquote(v);
  return v.replace(/\s+/g, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The VAPID keys from the Worker secrets, or which part is wrong (never the values). */
export function vapidConfig(): Vapid | { problem: VapidProblem } {
  const rawPub = process.env['ATLAS_VAPID_PUBLIC_KEY'], rawD = process.env['ATLAS_VAPID_PRIVATE_KEY'], subject = process.env['ATLAS_VAPID_SUBJECT']?.trim();
  if (!rawPub || !rawD || !subject) return { problem: 'missing' };
  if (!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject)) return { problem: 'bad-subject' };
  let pub: Uint8Array, d: Uint8Array;
  try { pub = unb64u(cleanKey(rawPub, 'ATLAS_VAPID_PUBLIC_KEY')); } catch { return { problem: 'bad-public-key' }; }
  try { d = unb64u(cleanKey(rawD, 'ATLAS_VAPID_PRIVATE_KEY')); } catch { return { problem: 'bad-private-key' }; }
  if (pub.length !== 65 || pub[0] !== 4) return { problem: 'bad-public-key' };
  // Some generators drop a private scalar's leading zero bytes: put them back.
  if (d.length < 32 && d.length >= 28) d = Uint8Array.from([...new Uint8Array(32 - d.length), ...d]);
  if (d.length !== 32) return { problem: 'bad-private-key' };
  return { pub, d, subject };
}
export function vapid(): Vapid | null {
  const v = vapidConfig();
  return 'problem' in v ? null : v;
}

/** Whether the private key signs what the public key verifies: a pair from two different runs doesn't. */
export async function vapidKeysMatch(v: Vapid): Promise<boolean> {
  try {
    const h = await vapidHeader('https://push.example/x', v.subject, v.d, v.pub);
    return await verifyVapid(h, null, v.pub, 'https://push.example');
  } catch { return false; }
}

/** AES-256-GCM key for sealing relay private keys, derived from the VAPID private key (no further secret needed). */
async function sealKey(v: Vapid): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', v.d as BufferSource, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('atlas-push-relay'), info: enc.encode('relay key seal v1') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const aad = (userId: string) => enc.encode(`atlas-push-relay|${userId}`);

type RelayRow = { user_id: string; relay_id: string; sealed_private: string; iv: string; public_key: string; auth_secret: string; server_key: string | null; alerts: unknown; policy: string };

async function newRelay(userId: string, v: Vapid): Promise<RelayRow> {
  const k = await newKeyPair();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(userId) }, await sealKey(v), k.d as BufferSource));
  return { user_id: userId, relay_id: b64u(crypto.getRandomValues(new Uint8Array(24))), sealed_private: b64u(sealed), iv: b64u(iv), public_key: b64u(k.pub), auth_secret: b64u(crypto.getRandomValues(new Uint8Array(16))), server_key: null, alerts: DEFAULT_ALERTS, policy: 'all' };
}
async function relayPrivate(row: RelayRow, v: Vapid): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(row.iv), additionalData: aad(row.user_id) }, await sealKey(v), unb64u(row.sealed_private)));
}

export type PushProblem = 'not-configured' | 'not-connected' | 'needs-permission' | 'unavailable' | 'bad-subscription';

const PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(push\.services\.mozilla\.com|fcm\.googleapis\.com|android\.googleapis\.com|web\.push\.apple\.com|notify\.windows\.com|push\.apple\.com)(:443)?\//i;
/** A browser push endpoint from a known push service: Atlas only ever posts to those (no SSRF through a "device"). */
export const pushEndpointAllowed = (u: string) => u.length <= 1024 && PUSH_HOSTS.test(u);

/** Adds this browser and makes sure Fedizen pushes to the relay. */
export async function addDevice(userId: string, token: string, origin: string, device: { endpoint: string; p256dh: string; auth: string }, choice?: { alerts: PushAlerts; policy: PushPolicy }): Promise<{ ok: true } | { ok: false; error: PushProblem }> {
  const v = vapid();
  if (!v) return { ok: false, error: 'not-configured' };
  if (!pushEndpointAllowed(device.endpoint)) return { ok: false, error: 'bad-subscription' };
  try { if (unb64u(device.p256dh).length !== 65 || unb64u(device.auth).length !== 16) return { ok: false, error: 'bad-subscription' }; } catch { return { ok: false, error: 'bad-subscription' }; }
  const db = await admin();
  // This service client bypasses RLS. Never permit upsert(onConflict: 'endpoint') to
  // silently reassign another user's push subscription to this account (IDOR).
  const { data: existingDevice, error: deviceLookupError } = await db.from('atlas_push_devices')
    .select('id, user_id').eq('endpoint', device.endpoint).maybeSingle();
  if (deviceLookupError) return { ok: false, error: 'unavailable' };
  if (existingDevice && existingDevice.user_id !== userId) return { ok: false, error: 'bad-subscription' };
  const { data: existing, error: relayLookupError } = await db.from('atlas_push_relays').select('*').eq('user_id', userId).maybeSingle();
  if (relayLookupError) return { ok: false, error: 'unavailable' };
  let row = existing as RelayRow | null;
  if (!row) {
    // Reserve one immutable relay ID/key pair per account *before* contacting Fedizen.
    // Concurrent device enrollments may both see no row; ignoreDuplicates preserves
    // the first reservation, and both requests then use that same canonical relay.
    const candidate = await newRelay(userId, v);
    const { error: reserveError } = await db.from('atlas_push_relays')
      .upsert({ ...candidate, alerts: candidate.alerts as unknown as Json }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (reserveError) return { ok: false, error: 'unavailable' };
    const { data: canonical, error: canonicalError } = await db.from('atlas_push_relays')
      .select('*').eq('user_id', userId).maybeSingle();
    if (canonicalError || !canonical) return { ok: false, error: 'unavailable' };
    row = canonical as RelayRow;
  }
  const alerts = choice?.alerts ?? (row.alerts as PushAlerts) ?? DEFAULT_ALERTS, policy = choice?.policy ?? (row.policy as PushPolicy) ?? 'all';
  // (Re)subscribe at Fedizen: Mastodon replaces the token's previous subscription, so this is safe to repeat.
  const r = await relayDeps.send(token, 'POST', '/api/v1/push/subscription', {
    subscription: { endpoint: `${origin}/api/push/relay/${row.relay_id}`, keys: { p256dh: row.public_key, auth: row.auth_secret } },
    data: { alerts, policy },
  }).catch(() => ({ status: 503, data: null }));
  if (r.status === 401 || r.status === 403) return { ok: false, error: r.status === 403 ? 'needs-permission' : 'not-connected' };
  if (r.status < 200 || r.status >= 300) return { ok: false, error: 'unavailable' };
  const serverKey = typeof r.data?.server_key === 'string' ? r.data.server_key : row.server_key;
  // Without Fedizen's VAPID key the relay can't tell its pushes from anyone else's, so it wouldn't accept any.
  if (!serverKey) return { ok: false, error: 'unavailable' };
  row = { ...row, server_key: serverKey, alerts, policy };
  const saved = await db.from('atlas_push_relays').upsert({ ...row, alerts: alerts as unknown as Json });
  if (saved.error) return { ok: false, error: 'unavailable' };
  // The UNIQUE(endpoint) index closes the concurrent-registration race:
  // an INSERT that loses to a different owner fails, never overwrites user_id.
  // A same-owner refresh is filtered by both row ID and authenticated owner.
  const dev = existingDevice
    ? await db.from('atlas_push_devices').update({ p256dh: device.p256dh, auth: device.auth })
      .eq('id', existingDevice.id).eq('user_id', userId)
    : await db.from('atlas_push_devices').insert({ user_id: userId, endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth });
  return dev.error ? { ok: false, error: 'unavailable' } : { ok: true };
}

/** Removes a browser; with none left, Fedizen stops pushing and the relay goes. */
export async function removeDevice(userId: string, token: string | null, endpoint: string | null) {
  const db = await admin();
  if (endpoint) await db.from('atlas_push_devices').delete().eq('user_id', userId).eq('endpoint', endpoint);
  else await db.from('atlas_push_devices').delete().eq('user_id', userId);
  const { count } = await db.from('atlas_push_devices').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (count) return;
  if (token) await relayDeps.send(token, 'DELETE', '/api/v1/push/subscription').catch(() => null);
  await db.from('atlas_push_relays').delete().eq('user_id', userId);
}

/** Which notifications push, and from whom (Mastodon alerts and policy). */
export async function setChoice(userId: string, token: string, alerts: PushAlerts, policy: PushPolicy): Promise<boolean> {
  const r = await relayDeps.send(token, 'PUT', '/api/v1/push/subscription', { data: { alerts, policy } }).catch(() => ({ status: 503 }));
  if (r.status < 200 || r.status >= 300) return false;
  const db = await admin();
  return !(await db.from('atlas_push_relays').update({ alerts: alerts as unknown as Json, policy }).eq('user_id', userId)).error;
}

export async function pushState(userId: string, endpoint: string | null) {
  const db = await admin();
  const [{ data: relay }, { data: dev }] = await Promise.all([
    db.from('atlas_push_relays').select('alerts, policy').eq('user_id', userId).maybeSingle(),
    endpoint ? db.from('atlas_push_devices').select('id').eq('user_id', userId).eq('endpoint', endpoint).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return { thisDevice: !!dev, alerts: { ...DEFAULT_ALERTS, ...((relay?.alerts as Partial<PushAlerts>) ?? {}) }, policy: ((relay?.policy as PushPolicy) ?? 'all') };
}

const KINDS: Record<string, string> = { mention: 'mention', status: 'status', reblog: 'reblog', follow: 'follow', follow_request: 'follow_request', favourite: 'favourite', poll: 'poll', update: 'update', quote: 'quote' };
const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** What Atlas pushes to a browser, from Fedizen's payload: never its access_token, ids, or links. */
export function safeNotice(payload: unknown): { title: string; body: string; kind: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const title = clip(p.title, 120), body = clip(p.body, 240);
  if (!title && !body) return null;
  return { title: title || 'Fedizen', body, kind: KINDS[typeof p.notification_type === 'string' ? p.notification_type : ''] ?? 'other' };
}

/**
 * A push from Fedizen to the relay. Answers 201 when handled (even when no device took it), 404 for an unknown relay,
 * 401 when the VAPID signature isn't Fedizen's, 400 for a message that doesn't decrypt.
 */
export async function relay(relayId: string, request: Request): Promise<Response> {
  const v = vapid();
  if (!v || !/^[A-Za-z0-9_-]{22,64}$/.test(relayId)) return new Response(null, { status: 404 });
  if ((request.headers.get('content-encoding') ?? '').toLowerCase() !== 'aes128gcm') return new Response(null, { status: 415 });
  const len = Number(request.headers.get('content-length') ?? '0');
  if (len > 8192) return new Response(null, { status: 413 });
  const db = await admin();
  const { data } = await db.from('atlas_push_relays').select('*').eq('relay_id', relayId).maybeSingle();
  const row = data as RelayRow | null;
  if (!row) return new Response(null, { status: 404 });
  // Only Fedizen's signature counts (its key comes back when subscribing); without one, nothing is accepted.
  if (!row.server_key || !(await verifyVapid(request.headers.get('authorization'), request.headers.get('crypto-key'), unb64u(row.server_key), new URL(request.url).origin))) return new Response(null, { status: 401 });
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > 8192) return new Response(null, { status: 413 });
  let notice: ReturnType<typeof safeNotice>;
  try {
    const plain = await decryptPush(body, await relayPrivate(row, v), unb64u(row.public_key), unb64u(row.auth_secret));
    notice = safeNotice(JSON.parse(new TextDecoder().decode(plain)));
  } catch { return new Response(null, { status: 400 }); }
  if (!notice) return new Response(null, { status: 201 });
  const { data: devices } = await db.from('atlas_push_devices').select('id, endpoint, p256dh, auth').eq('user_id', row.user_id).limit(20);
  const message = enc.encode(JSON.stringify(notice));
  await Promise.all((devices ?? []).map(async d => {
    if (!pushEndpointAllowed(d.endpoint)) return;
    try {
      const res = await fetch(d.endpoint, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
        headers: { authorization: await vapidHeader(d.endpoint, v.subject, v.d, v.pub), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: notice.kind === 'mention' ? 'high' : 'normal' },
        body: await encryptPush(message, unb64u(d.p256dh), unb64u(d.auth)) as BodyInit,
      });
      // Gone: the browser unsubscribed or the subscription expired.
      if (res.status === 404 || res.status === 410) await db.from('atlas_push_devices').delete().eq('id', d.id);
      else if (res.ok) await db.from('atlas_push_devices').update({ last_ok_at: new Date().toISOString() }).eq('id', d.id);
    } catch { /* the push service didn't answer: Fedizen's next push tries again */ }
  }));
  return new Response(null, { status: 201 });
}
