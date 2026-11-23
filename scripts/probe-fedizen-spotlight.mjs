#!/usr/bin/env node
/**
 * Bounded, zero-credential observation of the actual deployed Fedizen REST
 * endpoints used by Spotlight. Prints no post bodies, URL, handles, names,
 * remote error messages, secrets or response snippets. Never follows redirects.
 */
const HOST = 'https://fedizen.net';
const ROUTES = [
  ['/api/v1/trends/links?limit=12', 'trending-links'],
  ['/api/v1/timelines/public?limit=30', 'federated-public'],
];
const LIMIT = 1024 * 1024;
async function observe([path, kind]) {
  let response;
  try {
    response = await fetch(HOST + path, {
      method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store',
      headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    return { check: kind, status: 'transport-unavailable', code: error?.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
  const status = response.status;
  const type = response.headers.get('content-type') ?? '';
  const declared = Number(response.headers.get('content-length'));
  if (!response.ok || !type.includes('application/json') || declared > LIMIT || !response.body) {
    await response.body?.cancel().catch(() => {});
    return { check: kind, status: 'unavailable', http: status,
      category: status === 401 || status === 403 ? 'auth-required' :
        status === 404 ? 'missing-route' : status === 429 ? 'rate-limited' :
          declared > LIMIT ? 'too-large' : 'non-success-or-type' };
  }
  let bytes = 0;
  const pieces = [];
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > LIMIT) return { check: kind, status: 'unavailable', http: status, category: 'too-large' };
      pieces.push(value);
    }
  } catch { return { check: kind, status: 'unavailable', http: status, category: 'stream' }; }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const merged = new Uint8Array(bytes);
  let pos = 0;
  for (const chunk of pieces) { merged.set(chunk, pos); pos += chunk.byteLength; }
  let payload;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(merged)); }
  catch { return { check: kind, status: 'unavailable', http: status, category: 'invalid-json' }; }
  if (!Array.isArray(payload)) return { check: kind, status: 'unavailable', http: status, category: 'non-array' };
  if (kind === 'trending-links') {
    const valid = payload.filter(x => x && typeof x === 'object' && typeof x.url === 'string' && typeof x.title === 'string').length;
    return { check: kind, status: 'readable', http: status, items: payload.length, validCards: valid,
      hasHistory: payload.some(x => Array.isArray(x?.history)) };
  }
  return { check: kind, status: 'readable', http: status, items: payload.length,
    publicPosts: payload.filter(x => x?.visibility === 'public').length,
    videoPosts: payload.filter(x => x?.visibility === 'public' && Array.isArray(x?.media_attachments) &&
      x.media_attachments.some(m => m?.type === 'video')).length };
}
for (const route of ROUTES) console.log(JSON.stringify(await observe(route)));
