/**
 * HTTP response compression for the gateway's public JSON API: Zstandard, Brotli or gzip, chosen from the
 * client's Accept-Encoding (RFC 9110 §12.5.3) with the server's own preference breaking ties.
 *
 * Why these three, in this order, at these levels (bench/compression.ts, Bun 1.4.4, a 15-item page ≈ 13 KB):
 *   zstd 6 → 4.2 KB in ≈0.14 ms; br 5 → 4.0 KB in ≈0.22 ms; gzip 6 → 4.3 KB in ≈0.15 ms.
 * zstd matches gzip 6's size at the same or lower cost and decodes fastest; Brotli 5 is a little smaller and is what
 * Cloudflare asks the origin for ("accept-encoding: br, gzip"), so the tunnel leg gets Brotli and direct zstd
 * clients (Chrome 123+, Firefox 126+, Safari 26.3+) get zstd. Higher levels cost several times more CPU for 1–2 %.
 *
 * Standards: zstd content coding RFC 8878; HTTP frames must not need a window over 8 MB (RFC 9659). Our bodies are
 * well under 1 MB and libzstd sizes the window to the input, so every frame stays far below that limit (tested).
 * gzip is RFC 1952 (DEFLATE, RFC 1951, 32 KB window); Brotli RFC 7932.
 *
 * Security: only public, credential-free JSON is compressed (no cookies, no tokens, CORS without credentials), so
 * there is no secret for a compression side channel (BREACH-style) to recover. Admin responses are never compressed.
 */
import { brotliCompressSync, constants as Z, gzipSync, zstdCompressSync } from 'node:zlib';

export type Coding = 'zstd' | 'br' | 'gzip';
/** Server preference when the client rates several codings equally. */
export const PREFERENCE: readonly Coding[] = ['zstd', 'br', 'gzip'];
/** Below this, framing overhead and CPU outweigh the bytes saved (a TCP/QUIC packet carries ~1.2–1.4 KB). */
export const MIN_BYTES = 1024;
export const LEVELS = { zstd: 6, br: 5, gzip: 6 } as const;
const COMPRESSIBLE = /^(application\/(json|[\w.+-]+\+json)|text\/[\w.+-]+)(;|$)/i;

/**
 * Picks a coding from Accept-Encoding. Highest q wins; ties go to PREFERENCE. "*" stands for any coding not named;
 * q=0 refuses. No header, or nothing acceptable, means no compression (identity is always allowed to fall back to).
 */
export function negotiate(accept: string | null, offered: readonly Coding[] = PREFERENCE): Coding | null {
  if (!accept) return null;
  const q = new Map<string, number>();
  for (const part of accept.split(',')) {
    const [rawName, ...params] = part.trim().split(';');
    const name = (rawName ?? '').trim().toLowerCase();
    if (!name) continue;
    let weight = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([01](?:\.\d{0,3})?)\s*$/i.exec(p);
      if (m) weight = Math.min(1, Number(m[1]));
    }
    // "x-gzip" is gzip's registered alias (RFC 9110 §8.4.1.3).
    q.set(name === 'x-gzip' ? 'gzip' : name, weight);
  }
  let best: Coding | null = null;
  let bestQ = 0;
  for (const coding of offered) {
    const weight = q.get(coding) ?? q.get('*') ?? 0;
    if (weight > bestQ) { best = coding; bestQ = weight; }
  }
  return best;
}

export function encode(body: Uint8Array<ArrayBuffer>, coding: Coding): Uint8Array<ArrayBuffer> {
  switch (coding) {
    case 'zstd': return new Uint8Array(zstdCompressSync(body, { params: { [Z.ZSTD_c_compressionLevel]: LEVELS.zstd } }));
    case 'br': return new Uint8Array(brotliCompressSync(body, { params: { [Z.BROTLI_PARAM_QUALITY]: LEVELS.br, [Z.BROTLI_PARAM_SIZE_HINT]: body.length, [Z.BROTLI_PARAM_MODE]: Z.BROTLI_MODE_TEXT } }));
    case 'gzip': return new Uint8Array(gzipSync(body, { level: LEVELS.gzip }));
  }
}

function addVary(headers: Headers, field: string) {
  const current = headers.get('vary');
  if (!current) { headers.set('vary', field); return; }
  if (!current.split(',').some(v => v.trim().toLowerCase() === field.toLowerCase() || v.trim() === '*')) headers.set('vary', `${current}, ${field}`);
}

/**
 * Compresses a successful public GET response when the client accepts it. Anything else passes through untouched.
 * The response always says it varies by Accept-Encoding, so caches keep encoded and plain copies apart.
 */
export async function compress(req: Request, res: Response): Promise<Response> {
  if (req.method !== 'GET' || res.status !== 200 || !res.body || res.headers.has('content-encoding')) return res;
  if (!COMPRESSIBLE.test(res.headers.get('content-type') ?? '')) return res;
  const headers = new Headers(res.headers);
  addVary(headers, 'accept-encoding');
  const coding = negotiate(req.headers.get('accept-encoding'));
  const body = new Uint8Array(await res.arrayBuffer());
  if (!coding || body.length < MIN_BYTES) return new Response(body, { status: res.status, statusText: res.statusText, headers });
  const encoded = encode(body, coding);
  // Never send a "compressed" body that came out larger.
  if (encoded.length >= body.length) return new Response(body, { status: res.status, statusText: res.statusText, headers });
  headers.set('content-encoding', coding);
  headers.delete('content-length');
  return new Response(encoded, { status: res.status, statusText: res.statusText, headers });
}
