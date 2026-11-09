#!/usr/bin/env node
/**
 * Fedizen deployed Mastodon-compatible REST contract observation.
 *
 * The Mastodon REST API has no standard GraphQL-style introspection.
 * Observe only a small, static set of GET routes; never assume Bonfire
 * implements all Mastodon endpoints or treat a 404 as definitive evidence.
 *
 * No bearer, cookies, account identifiers, content, body or raw server error
 * is printed. Protected endpoints are accessed anonymously ONLY to verify
 * whether their access control is enforced; no mutation is ever invoked.
 *
 * node scripts/probe-fedizen-mastodon-rest.mjs --self-test
 * node scripts/probe-fedizen-mastodon-rest.mjs
 */
import assert from 'node:assert/strict';

const ORIGIN = 'https://fedizen.net';
const MAX_BYTES = 128 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;

/** Deliberately static, bounded routes: never send arbitrary/user URLs. */
export const ROUTES = Object.freeze([
  { id: 'instance-v2', path: '/api/v2/instance', exposure: 'public', shape: 'instance' },
  { id: 'instance-v1', path: '/api/v1/instance', exposure: 'public', shape: 'instance' },
  { id: 'custom-emojis', path: '/api/v1/custom_emojis', exposure: 'public', shape: 'emoji-list' },
  { id: 'public-timeline', path: '/api/v1/timelines/public?limit=1', exposure: 'public', shape: 'status-list' },
  { id: 'account-verification', path: '/api/v1/accounts/verify_credentials', exposure: 'protected', shape: 'account' },
  { id: 'home-timeline', path: '/api/v1/timelines/home?limit=1', exposure: 'protected', shape: 'status-list' },
  { id: 'notifications', path: '/api/v1/notifications?limit=1', exposure: 'protected', shape: 'notification-list' },
]);

function object(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function recognizeShape(kind, payload) {
  if (kind === 'instance') {
    return object(payload) && [payload.domain, payload.uri, payload.title].some(v => typeof v === 'string' && v.length > 0)
      ? 'observed' : 'mismatch';
  }
  if (!Array.isArray(payload) || payload.length > 1) return 'mismatch';
  if (payload.length === 0) return 'empty-unconfirmed';
  const first = payload[0];
  if (kind === 'emoji-list') {
    // The emoji endpoint is not requested with a limit; it can contain >1.
    return object(first) && typeof first.shortcode === 'string' ? 'observed' : 'mismatch';
  }
  if (kind === 'status-list') return object(first) && typeof first.id === 'string' && first.id.length > 0 ? 'observed' : 'mismatch';
  if (kind === 'notification-list') return object(first) && typeof first.id === 'string' && typeof first.type === 'string' ? 'observed' : 'mismatch';
  return 'mismatch';
}

export function classifyRoute(route, status, jsonValid = false, shape = 'mismatch') {
  if (route.exposure === 'protected') {
    if (status === 401 || status === 403) return 'anonymous-denied';
    if (status === 200) return 'unexpected-anonymous-success';
    if (status === 404 || status === 405) return 'route-unconfirmed';
    return 'inconclusive';
  }
  if (status === 404 || status === 405) return 'route-unconfirmed';
  if (status === 401 || status === 403) return 'public-read-restricted';
  if (status === 429 || status >= 500) return 'inconclusive';
  if (status !== 200) return 'unverified';
  if (!jsonValid || shape === 'mismatch') return 'shape-mismatch';
  return shape === 'empty-unconfirmed' ? 'shape-unconfirmed-empty' : 'response-observed';
}

async function readBoundedJson(response) {
  const size = response.headers.get('content-length');
  if (size !== null && Number(size) > MAX_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error('oversize');
  }
  const mime = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!mime.includes('application/json') && !mime.includes('+json')) {
    await response.body?.cancel().catch(() => {});
    throw new Error('non-json');
  }
  if (!response.body) throw new Error('missing-body');
  const reader = response.body.getReader();
  let total = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error('oversize');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export async function probeRoute(route, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(ORIGIN + route.path, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch {
    return { route: route.id, exposure: route.exposure, outcome: 'inconclusive' };
  }
  const status = response.status;
  if (status !== 200 || route.exposure === 'protected') {
    await response.body?.cancel().catch(() => {});
    return { route: route.id, exposure: route.exposure, httpStatus: status,
      outcome: classifyRoute(route, status) };
  }
  try {
    const parsed = await readBoundedJson(response);
    const shape = recognizeShape(route.shape, parsed);
    return { route: route.id, exposure: route.exposure, httpStatus: status,
      outcome: classifyRoute(route, status, true, shape) };
  } catch {
    return { route: route.id, exposure: route.exposure, httpStatus: status,
      outcome: classifyRoute(route, status, false) };
  }
}

async function live() {
  let risk = false;
  let observed = 0;
  const results = [];
  for (const route of ROUTES) {
    const result = await probeRoute(route);
    if (result.outcome === 'unexpected-anonymous-success') risk = true;
    if (result.outcome === 'response-observed' || result.outcome === 'anonymous-denied') observed++;
    results.push(result);
  }
  // No raw Mastodon data is ever logged. A passing observation is NOT a full
  // route schema, feature completeness, or a logged-in user grant test.
  console.log(JSON.stringify({ status: risk ? 'security-warning' : observed ? 'partial-observation' : 'inconclusive',
    checked: results.length, results }));
  if (risk) process.exitCode = 1;
}

async function selfTest() {
  const pub = ROUTES[0];
  const home = ROUTES[5];
  assert.equal(classifyRoute(pub, 200, true, 'observed'), 'response-observed');
  assert.equal(classifyRoute(pub, 200, true, 'empty-unconfirmed'), 'shape-unconfirmed-empty');
  assert.equal(classifyRoute(pub, 200, false), 'shape-mismatch');
  assert.equal(classifyRoute(pub, 404), 'route-unconfirmed');
  assert.equal(classifyRoute(pub, 503), 'inconclusive');
  assert.equal(classifyRoute(home, 401), 'anonymous-denied');
  assert.equal(classifyRoute(home, 403), 'anonymous-denied');
  assert.equal(classifyRoute(home, 503), 'inconclusive');
  assert.equal(classifyRoute(home, 404), 'route-unconfirmed');
  assert.equal(classifyRoute(home, 200), 'unexpected-anonymous-success');
  assert.equal(recognizeShape('instance', { domain: 'fedizen.net' }), 'observed');
  assert.equal(recognizeShape('instance', { error: 'not-found' }), 'mismatch');
  assert.equal(recognizeShape('status-list', []), 'empty-unconfirmed');
  assert.equal(recognizeShape('status-list', [{ id: 'a' }]), 'observed');
  assert.equal(recognizeShape('status-list', [{ content: 'private-data' }]), 'mismatch');
  let count = 0;
  const fake = async (url, init) => {
    count++;
    assert.equal(url, ORIGIN + '/api/v1/timelines/home?limit=1');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.equal(new Headers(init.headers).has('authorization'), false);
    return new Response(JSON.stringify([{ id: 'private-post' }]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await probeRoute(home, fake);
  assert.equal(result.outcome, 'unexpected-anonymous-success');
  assert.equal(JSON.stringify(result).includes('private-post'), false);
  assert.equal(count, 1);
  console.log('PASS: Mastodon REST route shape, denial and no-content-output tests');
}

if (process.argv.includes('--self-test')) await selfTest();
else await live();
