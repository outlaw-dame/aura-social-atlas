import { describe, expect, test } from 'bun:test';
import { brotliDecompressSync, constants as Z, gunzipSync, zstdDecompressSync } from 'node:zlib';
import type { Sql } from 'postgres';
import { compress, encode, MIN_BYTES, negotiate } from './compress.ts';
import { createHandler } from './http.ts';
import { loadConfig } from './config.ts';
import type { Gateway } from './federation.ts';

const decode = { zstd: (b: Uint8Array) => zstdDecompressSync(b, { params: { [Z.ZSTD_d_windowLogMax]: 23 } }), br: brotliDecompressSync, gzip: gunzipSync };
const big = JSON.stringify({ items: Array.from({ length: 60 }, (_, i) => ({ id: `https://mastodon.social/users/u${i}/statuses/${i}`, text: `<p>Post ${i} about #urbanism and transit in the city.</p>`, hashtags: ['urbanism'] })) });
const jsonRes = (s: string, init: ResponseInit = {}) => new Response(s, { status: 200, ...init, headers: { 'content-type': 'application/json;charset=utf-8', ...(init.headers as Record<string, string> | undefined) } });
const get = (accept?: string) => new Request('https://gateway.example/api/v1/items', { headers: accept ? { 'accept-encoding': accept } : {} });

describe('Accept-Encoding negotiation (RFC 9110 §12.5.3)', () => {
  test('browsers that offer zstd get it; Cloudflare edge (br, gzip) gets Brotli; gzip-only clients get gzip', () => {
    expect(negotiate('gzip, deflate, br, zstd')).toBe('zstd'); // Chrome 123+, Firefox 126+, Safari 26.3+
    expect(negotiate('br, gzip')).toBe('br');
    expect(negotiate('gzip, deflate')).toBe('gzip');
    expect(negotiate('x-gzip')).toBe('gzip');
    expect(negotiate('GZIP')).toBe('gzip');
  });
  test('q-values decide; ties go to zstd, then br, then gzip; q=0 refuses; * covers the rest', () => {
    expect(negotiate('zstd;q=0.5, gzip')).toBe('gzip');
    expect(negotiate('zstd;q=0, br;q=0.8, gzip;q=0.8')).toBe('br');
    expect(negotiate('*')).toBe('zstd');
    expect(negotiate('*;q=0, gzip')).toBe('gzip');
    expect(negotiate('*;q=0.1, zstd;q=0')).toBe('br');
    expect(negotiate('gzip;q=0')).toBeNull();
  });
  test('no header, identity, or only unknown codings mean no compression', () => {
    expect(negotiate(null)).toBeNull();
    expect(negotiate('')).toBeNull();
    expect(negotiate('identity')).toBeNull();
    expect(negotiate('compress, deflate')).toBeNull();
  });
});

describe('compressing public JSON', () => {
  for (const coding of ['zstd', 'br', 'gzip'] as const) {
    test(`${coding}: round-trips, labels the coding, varies by Accept-Encoding, and is smaller`, async () => {
      const res = await compress(get(coding), jsonRes(big, { headers: { vary: 'origin' } }));
      expect(res.headers.get('content-encoding')).toBe(coding);
      expect(res.headers.get('vary')).toBe('origin, accept-encoding');
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes.length).toBeLessThan(Buffer.byteLength(big) / 3);
      expect(Buffer.from(decode[coding](bytes)).toString()).toBe(big);
    });
  }
  test('zstd frames fit HTTP\'s 8 MB window limit (RFC 9659), even for a 4 MB body', () => {
    const huge = new Uint8Array(Buffer.from(big.repeat(Math.ceil(4_000_000 / big.length))));
    // windowLogMax 23 = 8 MiB: decoding fails if a frame needs a larger window.
    expect(decode.zstd(encode(huge, 'zstd')).length).toBe(huge.length);
  });
  test('small, failed, non-GET, non-JSON and already-encoded responses pass through', async () => {
    const small = await compress(get('zstd'), jsonRes('{"ok":true}'));
    expect(small.headers.get('content-encoding')).toBeNull();
    expect(small.headers.get('vary')).toBe('accept-encoding');
    expect(await small.text()).toBe('{"ok":true}');
    expect(MIN_BYTES).toBe(1024);
    const failed = await compress(get('zstd'), new Response(big, { status: 503, headers: { 'content-type': 'application/json' } }));
    expect(failed.headers.get('content-encoding')).toBeNull();
    const post = await compress(new Request('https://gateway.example/api/v1/items', { method: 'POST', headers: { 'accept-encoding': 'zstd' } }), jsonRes(big));
    expect(post.headers.get('content-encoding')).toBeNull();
    const png = await compress(get('zstd'), new Response(big, { headers: { 'content-type': 'image/png' } }));
    expect(png.headers.get('content-encoding')).toBeNull();
    const already = await compress(get('zstd'), jsonRes('x', { headers: { 'content-encoding': 'gzip' } }));
    expect(already.headers.get('content-encoding')).toBe('gzip');
  });
  test('a client that accepts nothing gets the plain body, still marked as varying', async () => {
    const res = await compress(get(), jsonRes(big));
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('vary')).toBe('accept-encoding');
    expect(await res.text()).toBe(big);
  });
});

describe('the gateway handler', () => {
  const cfg = loadConfig({ GATEWAY_ORIGIN: 'https://gateway.example', DATABASE_URL: 'postgres://t:t@localhost/t', GATEWAY_ADMIN_TOKEN: 'abcdef0123456789abcdef0123456789' });
  const gateway = { fetch: async () => new Response('actor', { status: 200 }) } as unknown as Gateway;
  const domains = Array.from({ length: 150 }, (_, i) => ({ origin: `https://instance${i}.social` }));
  const sql = ((strings: TemplateStringsArray) => Promise.resolve(strings.join('').includes('selector') ? [{ selector: 'urbanism' }] : domains)) as unknown as Sql;
  test('compresses /api/ responses for the public listener', async () => {
    const res = await createHandler({ cfg, gateway, sql })(new Request('https://gateway.example/api/v1/facets', { headers: { 'accept-encoding': 'br, gzip' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('br');
    const facets = JSON.parse(Buffer.from(brotliDecompressSync(new Uint8Array(await res.arrayBuffer()))).toString());
    expect(facets.domains).toHaveLength(150);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  test('never compresses on the admin listener', async () => {
    const res = await createHandler({ cfg, gateway, sql, adminEnabled: true })(new Request('https://gateway.example/api/v1/facets', { headers: { 'accept-encoding': 'zstd' } }));
    expect(res.headers.get('content-encoding')).toBeNull();
  });
});
