/**
 * Compression benchmark for the gateway's public JSON (/api/v1/items pages and /api/v1/facets).
 * Payloads are built in the exact publicItem shape; post text is natural-language prose taken from this
 * repository's own docs (no network in CI), with realistic handles, URLs, hashtags and ISO dates.
 * Run: bun bench/compression.ts
 */
import { gzipSync, brotliCompressSync, zstdCompressSync, constants as Z } from 'node:zlib';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..');
const prose = ['README.md', 'AGENTS.md', 'roadmap.md', 'discovery-gateway/README.md', 'discovery-gateway/OPERATIONS.md', 'relay/README.md']
  .map(f => { try { return readFileSync(join(root, f), 'utf8'); } catch { return ''; } }).join('\n')
  .replace(/[`#*>|_\[\]()]/g, ' ').split(/(?<=[.!?])\s+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s.length > 30);

let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const hosts = ['mastodon.social', 'fosstodon.org', 'hachyderm.io', 'mas.to', 'infosec.exchange', 'fedizen.net', 'social.coop', 'tech.lgbt'];
const tags = ['urbanism', 'transit', 'linux', 'opensource', 'photography', 'science', 'space', 'cycling', 'books', 'fediverse', 'music', 'design'];
const names = ['Ann Lee', 'Sam Okafor', 'Rosa Diaz', 'Kenji Mori', 'Priya Natarajan', 'Lena Ortiz', 'Marcus Webb', 'Jo Park'];

function item(i: number) {
  const host = pick(hosts); const name = pick(names); const user = name.toLowerCase().replace(/\s+/g, '');
  const id = `https://${host}/users/${user}/statuses/${113000000000000000 + Math.floor(rnd() * 1e15)}`;
  const n = 1 + Math.floor(rnd() * 4);
  const text = Array.from({ length: n }, () => pick(prose)).join(' ').slice(0, 1200);
  const hs = Array.from({ length: Math.floor(rnd() * 4) }, () => pick(tags));
  const t = new Date(Date.UTC(2026, 10, 15, 12) - i * 97_000).toISOString();
  return {
    id, url: id.replace('/users/', '/@').replace('/statuses/', '/'), text: `<p>${text}</p>`, summary: rnd() < 0.1 ? 'Spoilers' : null,
    author: { name, handle: `@${user}@${host}`, url: `https://${host}/@${user}`, id: `https://${host}/users/${user}` },
    origin: `https://${host}`, hashtags: hs, publishedAt: t, ingestedAt: t, via: pick(['https://relay.fedi.buzz/tag/' + pick(tags), 'https://relay.example/actor']),
  };
}
const page = (n: number) => JSON.stringify({ items: Array.from({ length: n }, (_, i) => item(i)), nextCursor: 'eyJ0IjoiMjAyNi0xMS0xNVQxMjowMDowMFoiLCJpIjoiaHR0cHM6Ly9leGFtcGxlIn0' });
const facets = JSON.stringify({ tags: tags.slice(), domains: hosts.concat(Array.from({ length: 120 }, (_, i) => `instance${i}.social`)) });

type Enc = { name: string; run: (b: Buffer) => Buffer };
const encs: Enc[] = [
  ...[1, 6, 9].map(l => ({ name: `gzip ${l}`, run: (b: Buffer) => gzipSync(b, { level: l }) })),
  ...[4, 5, 6, 11].map(q => ({ name: `br ${q}`, run: (b: Buffer) => brotliCompressSync(b, { params: { [Z.BROTLI_PARAM_QUALITY]: q, [Z.BROTLI_PARAM_SIZE_HINT]: b.length } }) })),
  ...[1, 3, 6, 9, 12, 19].map(l => ({ name: `zstd ${l}`, run: (b: Buffer) => zstdCompressSync(b, { params: { [Z.ZSTD_c_compressionLevel]: l } }) })),
];

function bench(label: string, s: string) {
  const b = Buffer.from(s);
  console.log(`\n${label}: ${b.length} bytes raw`);
  console.log('encoder    bytes   ratio  saved   median µs');
  for (const e of encs) {
    let out = e.run(b); const times: number[] = [];
    for (let i = 0; i < 60; i++) { const t0 = Bun.nanoseconds(); out = e.run(b); times.push((Bun.nanoseconds() - t0) / 1000); }
    times.sort((a, z) => a - z);
    console.log(`${e.name.padEnd(9)} ${String(out.length).padStart(6)}  ${(b.length / out.length).toFixed(2).padStart(5)}  ${(100 * (1 - out.length / b.length)).toFixed(1).padStart(5)}%  ${times[30].toFixed(0).padStart(9)}`);
  }
}
console.log(`Bun ${Bun.version}`);
bench('items page, limit 15 (Atlas default)', page(15));
bench('items page, limit 50 (maximum)', page(50));
bench('facets', facets);
