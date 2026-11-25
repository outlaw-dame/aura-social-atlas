import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { inPool } from '../src/lib/in-pool';
import { readKeptPublic, writeKeptPublic } from '../src/lib/kept-public';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
});

describe('a page waits for the longest extra, not their sum', () => {
  test("Home's posts, their reply parents and notices' faces are looked up at the same time", () => {
    const enrich = readFileSync('src/lib/feed-enrich.server.ts', 'utf8');
    expect(enrich).toMatch(/const \[enriched, parents\] = await Promise\.all\(\[\s*withArticleAuthorsAndFaces\(posts, budgetMs\),\s*token \? replyParents\(/);
    const fns = readFileSync('src/lib/fedizen.functions.ts', 'utf8');
    expect(fns).toMatch(/const \[posts, notices\] = await Promise\.all\(\[\s*withArticleAuthors\(fromStatuses\(home\.data as never\), 2000, t\.access_token\),\s*withActorAvatars\(/);
    expect(fns).toMatch(/const \[hydrated, enriched\] = await Promise\.all\(\[inPool\(posts, 8, hydrate\), withArticleAuthors\(posts\)\]\)/);
  });

  test('a pool keeps n going at once, starts the next as one finishes, and keeps order', async () => {
    let running = 0, most = 0;
    const out = await inPool([30, 5, 5, 5, 5], 2, async ms => { running++; most = Math.max(most, running); await new Promise(r => setTimeout(r, ms)); running--; return ms; });
    expect(out).toEqual([30, 5, 5, 5, 5]);
    expect(most).toBe(2);
    expect(await inPool([], 8, async x => x)).toEqual([]);
  });
});

describe('waking the server', () => {
  test("the phone app opens on its saved shell when the server is slow or answers an error", () => {
    const sw = readFileSync('public/sw.js', 'utf8');
    expect(sw).toMatch(/const NAV_TIMEOUT_MS = 2000;/);
    expect(sw).toMatch(/return first && first\.ok \? first : kept;/);
  });

  test("Voices to know: kept a day on the server and on the device", () => {
    expect(readFileSync('src/lib/voices.functions.ts', 'utf8')).toMatch(/if \(avatarsKept && Date\.now\(\) - avatarsKept\.at < AVATARS_FOR_MS\) return avatarsKept\.value;/);
    writeKeptPublic('voices', { voices: [1] }, 200_000, 1000);
    expect(readKeptPublic('voices', 5000, 2000)).toEqual({ data: { voices: [1] }, savedAt: 1000 });
    expect(readKeptPublic('voices', 5000, 7000)).toBeNull();
    store.set('atlas-public:voices', '{');
    expect(readKeptPublic('voices', 5000, 2000)).toBeNull();
  });
});

describe("the person's Fedizen connection", () => {
  test('is read from Supabase once per 15 s per person and forgotten on connect and disconnect', () => {
    const src = readFileSync('src/lib/fedizen.server.ts', 'utf8');
    expect(src).toMatch(/const CONNECTION_MS = 15_000;/);
    expect(src).toMatch(/if \(hit && hit\.until > Date\.now\(\)\) return hit\.value;/);
    // A failed read isn't kept.
    expect(src).toMatch(/value\.catch\(\(\) => \{ if \(connections\.get\(userId\)\?\.value === value\) connections\.delete\(userId\); \}\);/);
    const connect = src.slice(src.indexOf('export async function finishConnect'), src.indexOf('export async function connectionFor'));
    expect(connect).toMatch(/forgetConnection\(userId\);/);
    const disconnect = src.slice(src.indexOf('export async function disconnect'));
    expect(disconnect.match(/forgetConnection\(userId\)/g)?.length).toBe(2);
  });
});
