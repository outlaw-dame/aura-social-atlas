import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { _flushLookups, _resetLookups, _setLookupDb, readLookups, writeLookup } from '../src/lib/lookup-cache.server';

type Row = { kind: string; key: string; value: unknown; expires_at: string };
let rows: Row[] = [];
let fail: { code: string } | null = null;
let slow = 0;
const fakeDb = {
  from: () => {
    const q: { kind?: string; keys?: string[]; after?: string } = {};
    const chain = {
      select: () => chain,
      eq: (_c: string, v: string) => { q.kind = v; return chain; },
      in: (_c: string, v: string[]) => { q.keys = v; return chain; },
      gt: async (_c: string, v: string) => {
        if (slow) await new Promise(r => setTimeout(r, slow));
        if (fail) return { data: null, error: fail };
        return { data: rows.filter(r => r.kind === q.kind && q.keys!.includes(r.key) && r.expires_at > v), error: null };
      },
      upsert: async (rs: Row[]) => { if (fail) return { error: fail }; for (const r of rs) { rows = rows.filter(x => !(x.kind === r.kind && x.key === r.key)); rows.push(r); } return { error: null }; },
      delete: () => ({ lt: async () => ({ error: null }) }),
    };
    return chain;
  },
};

beforeEach(() => { rows = []; fail = null; slow = 0; _resetLookups(); _setLookupDb(async () => fakeDb); });

describe('public lookups kept in Supabase across sleeps', () => {
  test('written in a batch and read back until they expire', async () => {
    writeLookup('avatar', 'https://a.example/users/x', { url: 'https://a.example/x.png' }, 60_000);
    writeLookup('avatar', 'https://a.example/users/x', { url: 'https://a.example/y.png' }, 60_000);
    await _flushLookups();
    expect(rows).toHaveLength(1);
    const got = await readLookups<{ url: string }>('avatar', ['https://a.example/users/x', 'https://b.example/u']);
    expect(got.get('https://a.example/users/x')).toEqual({ url: 'https://a.example/y.png' });
    expect(got.has('https://b.example/u')).toBe(false);
    expect((await readLookups('avatar', ['https://a.example/users/x'], Date.now() + 120_000)).size).toBe(0);
    expect((await readLookups('authors', ['https://a.example/users/x'])).size).toBe(0);
  });

  test('a slow database costs a page at most 400 ms, and a missing table turns it off quietly', async () => {
    slow = 2000;
    const t0 = Date.now();
    expect((await readLookups('avatar', ['k'])).size).toBe(0);
    expect(Date.now() - t0).toBeLessThan(700);
    slow = 0; fail = { code: '42P01' };
    expect((await readLookups('avatar', ['k'])).size).toBe(0);
    fail = null;
    writeLookup('avatar', 'k', { url: null }, 60_000);
    await _flushLookups();
    expect(rows).toHaveLength(0); // off for a while after the table was missing
  });

  test('oversized values and keys are not kept', async () => {
    writeLookup('authors', 'x'.repeat(3000), { a: 1 }, 60_000);
    writeLookup('authors', 'u', { big: 'y'.repeat(70_000) }, 60_000);
    await _flushLookups();
    expect(rows).toHaveLength(0);
  });

  test('avatars, article credits and Voices read it before the network and write what they find', () => {
    const enrich = readFileSync('src/lib/feed-enrich.server.ts', 'utf8');
    expect(enrich).toMatch(/readLookups<\{ url: string \| null \}>\('avatar', todo\)/);
    expect(enrich).toMatch(/writeLookup\('avatar', a, \{ url \}/);
    const authors = readFileSync('src/lib/article-author.server.ts', 'utf8');
    expect(authors).toMatch(/readLookups<\{ authors\?: FediAuthor\[\]; media\?: FoundMedia \}>\('authors', missing\)/);
    expect(authors).toMatch(/writeLookup\('authors', url,/);
    expect(readFileSync('src/lib/voices.server.ts', 'utf8')).toMatch(/writeLookup\('voices', 'all'/);
    expect(readFileSync('src/lib/voices.functions.ts', 'utf8')).toMatch(/writeLookup\('voice-avatars', 'all'/);
    const sql = readFileSync('supabase/migrations/20261125000000_lookup_cache.sql', 'utf8');
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke all on public\.atlas_lookup_cache from anon, authenticated/);
  });
});
