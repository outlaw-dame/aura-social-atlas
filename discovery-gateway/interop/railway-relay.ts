/**
 * Disposable, isolated, intentionally staging-only ActivityPub interoperability actor.
 *
 * Intended for a temporary Railway Function running on Bun. Never put this fixture
 * in production or attach it to an existing Fediverse user's identity.
 * It owns one ephemeral key pair and never persists private key material.
 * All state and activity IDs are synthetic. No public command/mutation endpoint.
 */
import { signRequest, verifyRequestDetailed } from '@fedify/fedify';

const origin = (Bun.env.INTEROP_RELAY_ORIGIN ?? '').replace(/\/$/, '');
const gatewayOrigin = (Bun.env.GATEWAY_ORIGIN ?? '').replace(/\/$/, '');
const internalGateway = 'http://gateway-web.railway.internal:4100';
const internalAdminGateway = 'http://gateway-web.railway.internal:4101';
const adminToken = Bun.env.GATEWAY_ADMIN_TOKEN ?? '';
const runEnabled = Bun.env.INTEROP_RUN_ON_BOOT === '1';
const asPublic = 'https://www.w3.org/ns/activitystreams#Public';
const encoder = new TextEncoder();

if (!origin.startsWith('https://') || !gatewayOrigin.startsWith('https://')) {
  throw new Error('INTEROP_RELAY_ORIGIN and GATEWAY_ORIGIN must be absolute HTTPS origins');
}
if (runEnabled && adminToken.length < 32) {
  throw new Error('Interop runner requires a private staging admin token');
}
const actorId = origin + '/actor';
const inbox = origin + '/inbox';
const gatewayActor = gatewayOrigin + '/actor';
const gatewayInbox = gatewayOrigin + '/actors/gateway/inbox';
const keyId = new URL(actorId + '#main-key');

const pair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
);
const keyDer = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
const pem = '-----BEGIN PUBLIC KEY-----\n' +
  Array.from({ length: Math.ceil(keyDer.length / 48) }, (_, i) =>
    btoa(String.fromCharCode(...keyDer.slice(i * 48, i * 48 + 48)))).join('\n') +
  '\n-----END PUBLIC KEY-----';

const documentHeaders = {
  'content-type': 'application/activity+json; charset=utf-8',
  'cache-control': 'no-store',
};
const actor = {
  '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
  id: actorId, type: 'Service', preferredUsername: 'atlas-interop-relay',
  name: 'Atlas isolated synthetic interoperability relay',
  inbox, outbox: origin + '/outbox', url: actorId,
  publicKey: { id: keyId.href, owner: actorId, publicKeyPem: pem },
};
const textNoteId = origin + '/objects/announced-note';
const advertisedNote = {
  id: textNoteId, type: 'Note', attributedTo: actorId, to: [asPublic],
  content: 'Synthetic Atlas relay announcement for isolated interoperability tests',
  published: new Date().toISOString(),
};
const activityContext = 'https://www.w3.org/ns/activitystreams';
const runStatus: { state: 'disabled' | 'ready' | 'running' | 'passed' | 'failed'; checks: string[] } = {
  state: runEnabled ? 'ready' : 'disabled', checks: [],
};
const log = (event: string, details: Record<string, unknown> = {}) => {
  if (event === 'pass' && typeof details.check === 'string') runStatus.checks.push(details.check);
  if (event === 'complete') runStatus.state = details.result === 'passed' ? 'passed' : 'failed';
  // Railway's Function runtime routes stderr consistently to the deploy log.
  console.error(JSON.stringify({ event: 'interop.' + event, ...details }));
};

let inboundFollow: { id: string; from: string } | null = null;
const observedFollowIds = new Set<string>();
let inboundAccept: { id: string; object: unknown } | null = null;
const observedUndoIds = new Set<string>();
let verifiedInbound = 0;

async function readBounded(request: Request, maxBytes = 32_768): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('inbox body too large');
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

const server = Bun.serve({
  port: Number(Bun.env.PORT || 3000),
  async fetch(request) {
    const u = new URL(request.url);
    if (request.method === 'GET' && u.pathname === '/healthz') {
      return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
    }
    if (request.method === 'GET' && u.pathname === '/interop-status') {
      return Response.json(runStatus, { headers: { 'cache-control': 'no-store' } });
    }
    if (request.method === 'GET' && u.pathname === '/actor') {
      return Response.json(actor, { headers: documentHeaders });
    }
    if (request.method === 'GET' && u.pathname === '/objects/announced-note') {
      return Response.json({ '@context': activityContext, ...advertisedNote }, { headers: documentHeaders });
    }
    if (request.method === 'GET' && u.pathname === '/.well-known/webfinger') {
      if (u.searchParams.get('resource') !== 'acct:atlas-interop-relay@' + u.host)
        return new Response('not found', { status: 404 });
      return Response.json({
        subject: 'acct:atlas-interop-relay@' + u.host,
        links: [{ rel: 'self', type: 'application/activity+json', href: actorId }],
      }, { headers: { 'content-type': 'application/jrd+json', 'cache-control': 'no-store' } });
    }
    if (request.method === 'POST' && u.pathname === '/inbox') {
      let verified;
      try { verified = await verifyRequestDetailed(request.clone(), { maxSignatures: 2 }); }
      catch { return new Response('bad signature', { status: 401 }); }
      if (!verified.verified) {
        log('signature_rejected', { reason: verified.reason?.type ?? 'unknown' });
        return new Response('unauthorized', { status: 401 });
      }
      // Cryptographic validity alone does not bind the signed request to its
      // ActivityPub actor. Verify key ownership independently of body.actor.
      // Fedify's key owner is represented as a URL on newer verification
      // results and as a method on vocabulary CryptographicKey instances.
      // Handle both shapes without trusting an unrecognized/missing owner.
      const field = (verified.key as unknown as {
        ownerId?: URL | (() => URL | null);
      }).ownerId;
      const owner = field instanceof URL ? field.href
        : typeof field === 'function' ? field.call(verified.key)?.href : null;
      if (owner !== gatewayActor) {
        log('signature_rejected', { reason: 'wrong_key_owner' });
        return new Response('unauthorized', { status: 401 });
      }
      let body: Record<string, unknown>;
      try { body = JSON.parse(await readBounded(request)) as Record<string, unknown>; }
      catch { return new Response('invalid body', { status: 400 }); }
      if (body.actor !== gatewayActor) return new Response('unknown sender', { status: 403 });
      if (body.type === 'Follow' &&
          typeof body.id === 'string' && body.object === actorId) {
        inboundFollow = { id: body.id, from: body.actor };
        observedFollowIds.add(body.id);
      } else if (body.type === 'Accept') {
        inboundAccept = { id: typeof body.id === 'string' ? body.id : '', object: body.object };
      } else if (body.type === 'Undo') {
        const undone = body.object && typeof body.object === 'object' &&
          !Array.isArray(body.object)
          ? (body.object as Record<string, unknown>).id : body.object;
        if (typeof undone === 'string' && observedFollowIds.has(undone))
          observedUndoIds.add(undone);
      }
      verifiedInbound++;
      log('signed_inbox_activity', { type: body.type });
      return new Response(null, { status: 202 });
    }
    return new Response('not found', { status: 404 });
  },
});
log('ready', { port: server.port, runEnabled });

const sleep = (ms: number) => Bun.sleep(ms);
async function awaitCondition(label: string, check: () => Promise<boolean> | boolean, durationMs = 60_000) {
  const cutoff = Date.now() + durationMs;
  while (Date.now() < cutoff) {
    if (await check()) { log('pass', { check: label }); return; }
    await sleep(500);
  }
  throw new Error('Timed out: ' + label);
}
async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    redirect: 'error', signal: AbortSignal.timeout(12_000), ...init,
  });
  const text = await response.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch {}
  return { status: response.status, body };
}
async function admin(path: string, method = 'GET', body?: unknown) {
  const response = await jsonFetch(internalAdminGateway + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + adminToken,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error('staging admin ' + method + ' ' + path + ': HTTP ' + response.status);
  }
  return response.body as Record<string, unknown>;
}
async function signedActivity(body: Record<string, unknown>) {
  const request = new Request(gatewayInbox, {
    method: 'POST',
    headers: { 'content-type': 'application/activity+json' },
    body: JSON.stringify({ '@context': activityContext, ...body }),
  });
  const signed = await signRequest(request, pair.privateKey, keyId, {
    spec: 'draft-cavage-http-signatures-12',
  });
  const response = await fetch(signed, {
    redirect: 'error', signal: AbortSignal.timeout(12_000),
  });
  if (response.status < 200 || response.status >= 300)
    throw new Error('signed ' + body.type + ' delivery failed: HTTP ' + response.status);
  log('signed_delivery', { type: body.type, status: response.status });
}
async function items() {
  const r = await jsonFetch(internalGateway + '/api/v1/items?limit=50');
  if (r.status !== 200) throw new Error('Discovery read HTTP ' + r.status);
  const b = r.body as { items?: Array<{ id?: string; text?: string }> };
  if (!Array.isArray(b.items)) throw new Error('unexpected discovery response');
  return b.items;
}

async function runInterop() {
  runStatus.state = 'running';
  let subscriptionId: string | null = null;
  try {
    // Internal private Railway service networking only. Public /admin stays blocked.
    const existing = (await admin('/admin/subscriptions')).subscriptions as
      Array<{ id: string; state: string; actorUrl: string }>;
    const current = existing.find(s => s.actorUrl === actorId);
    if (current?.state === 'accepted') {
      // Do not queue an earlier Undo that could be mistaken for the final
      // unsubscribe. Operator must use a fresh fixture actor for another run.
      throw new Error('historically accepted synthetic actor requires a fresh relay fixture');
    }
    const record = current
      ? await admin('/admin/subscriptions/' + encodeURIComponent(current.id) + '/retry', 'POST')
      : await admin('/admin/subscriptions', 'POST', {
          type: 'actor', kind: 'litepub', value: actorId,
        });
    // The public admin response intentionally withholds followActivityId.
    // Use only actual *verified* Follow requests; stale prior IDs cannot
    // transition the rotated pending subscription to accepted.
    const subscription = record.subscription as { id: string; state: string };
    subscriptionId = subscription.id;
    if (!subscriptionId || subscription.state !== 'pending')
      throw new Error('subscription did not enter pending Follow state');
    const replied = new Set<string>();
    await awaitCondition('gateway verified current Follow and persisted signed Accept', async () => {
      // Retried Follow deliveries can arrive out of order; never allow a
      // stale Follow to hide the new correlated ID in a last-value slot.
      for (const id of observedFollowIds) {
        if (replied.has(id)) continue;
        replied.add(id);
        await signedActivity({
          id: origin + '/activities/accept-' + crypto.randomUUID(),
          type: 'Accept', actor: actorId, object: id, to: [gatewayActor],
        });
      }
      const r = await admin('/admin/subscriptions');
      const subs = r.subscriptions as Array<{ id: string; state: string }>;
      return subs.some(s => s.id === subscriptionId && s.state === 'accepted');
    });
    const reciprocalId = origin + '/activities/follow-' + crypto.randomUUID();
    await signedActivity({
      id: reciprocalId, type: 'Follow', actor: actorId, object: gatewayActor, to: [gatewayActor],
    });
    await awaitCondition('gateway verified reciprocal Follow and signed Accept', () => inboundAccept !== null);

    const createdNote = origin + '/objects/created-' + crypto.randomUUID();
    const createdActivity = {
      id: origin + '/activities/create-' + crypto.randomUUID(),
      type: 'Create', actor: actorId, to: [asPublic],
      object: {
        id: createdNote, type: 'Note', attributedTo: actorId, to: [asPublic],
        content: 'Synthetic Atlas direct Create for isolated signed interoperability',
        published: new Date().toISOString(),
      },
    };
    await signedActivity(createdActivity);
    await awaitCondition('signed public Create ingested once', async () =>
      (await items()).filter(x => x.id === createdNote).length === 1,
    );
    await signedActivity(createdActivity);
    await sleep(1200);
    if ((await items()).filter(x => x.id === createdNote).length !== 1)
      throw new Error('Create replay duplicated the stored item');
    log('pass', { check: 'replayed Create did not duplicate item' });

    const privateId = origin + '/objects/private-' + crypto.randomUUID();
    await signedActivity({
      id: origin + '/activities/private-' + crypto.randomUUID(),
      type: 'Create', actor: actorId, to: [gatewayActor],
      object: { id: privateId, type: 'Note', attributedTo: actorId,
        to: [gatewayActor], content: 'synthetic private content' },
    });
    await sleep(1200);
    if ((await items()).some(x => x.id === privateId))
      throw new Error('private content was ingested');
    log('pass', { check: 'private Create not ingested' });

    await signedActivity({
      id: origin + '/activities/announce-' + crypto.randomUUID(),
      type: 'Announce', actor: actorId, to: [asPublic],
      object: textNoteId,
    });
    await awaitCondition('Announce origin Note fetched and ingested', async () =>
      (await items()).some(x => x.id === textNoteId),
    );
    await signedActivity({
      id: origin + '/activities/delete-' + crypto.randomUUID(),
      type: 'Delete', actor: actorId, to: [asPublic], object: createdNote,
    });
    await awaitCondition('authenticated original-author Delete removed Note', async () =>
      !(await items()).some(x => x.id === createdNote),
    );

    const undoIdsBeforeFinalDelete = new Set(observedUndoIds);
    await admin('/admin/subscriptions/' + encodeURIComponent(subscriptionId), 'DELETE');
    // Only count a newly received, signed Undo correlated with a verified
    // Follow for which this run sent Accept. A prior cleanup Undo cannot pass.
    await awaitCondition('new signed Undo for accepted Follow received', () =>
      [...observedUndoIds].some(id => !undoIdsBeforeFinalDelete.has(id) && replied.has(id)));
    await awaitCondition('subscription disabled after Undo', async () => {
      const r = await admin('/admin/subscriptions');
      const subs = r.subscriptions as Array<{ id: string; state: string }>;
      return subs.some(s => s.id === subscriptionId && s.state === 'disabled');
    });
    await signedActivity({
      id: origin + '/activities/late-create-' + crypto.randomUUID(),
      type: 'Create', actor: actorId, to: [asPublic],
      object: { id: origin + '/objects/late', type: 'Note', attributedTo: actorId,
        to: [asPublic], content: 'must never be ingested' },
    });
    await sleep(1200);
    if ((await items()).some(x => x.id === origin + '/objects/late'))
      throw new Error('disabled relay ingested late content');
    log('pass', { check: 'disabled relay cannot deliver late content' });
    log('complete', { result: 'passed', verifiedInbound });
  } catch (error) {
    log('complete', { result: 'failed', reason: error instanceof Error ? error.message : 'unknown' });
    if (subscriptionId) {
      await admin('/admin/subscriptions/' + encodeURIComponent(subscriptionId), 'DELETE')
        .catch(() => log('cleanup_failed'));
    }
  }
}

if (runEnabled) {
  // Start serving the publicly resolvable actor before initiating any signed
  // remote fetch. This is a one-shot test, not a background repeat loop.
  setTimeout(() => { void runInterop(); }, 10_000);
}
