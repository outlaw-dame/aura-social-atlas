/**
 * Duplicate suppression must be atomic across processes. These tests use real PostgreSQL semantics
 * (PGlite, Postgres compiled to WASM, behind a wire-protocol socket) through the same postgres.js +
 * PostgresKvStore stack production uses, with several independent connection pools standing in for
 * separate relay processes.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import postgres from 'postgres';
import { PostgresKvStore } from '@fedify/postgres';
import type { KvStore } from '@fedify/fedify';
import { claimActivityId } from './app.ts';

const PORT = 55433;
let db: PGlite; let server: PGLiteSocketServer;
const pools: ReturnType<typeof postgres>[] = [];

beforeAll(async () => {
  db = await PGlite.create();
  server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1', maxConnections: 16 });
  await server.start();
}, 30000);
afterAll(async () => { for (const p of pools) await p.end({ timeout: 1 }); await server.stop(); await db.close(); });

function store(): PostgresKvStore {
  const sql = postgres(`postgres://postgres@127.0.0.1:${PORT}/postgres`, { max: 4, onnotice: () => {} });
  pools.push(sql);
  return new PostgresKvStore(sql);
}

describe('activity id claim on PostgreSQL', () => {
  test('exactly one of many concurrent claims across separate pools wins', async () => {
    const stores = Array.from({ length: 6 }, store);
    await stores[0].initialize();
    for (let round = 0; round < 10; round++) {
      const id = `https://fedizen.net/activities/race-${round}`;
      const results = await Promise.all(stores.flatMap(s => [claimActivityId(s, id), claimActivityId(s, id), claimActivityId(s, id)]));
      expect(results.filter(Boolean)).toHaveLength(1);
    }
  }, 30000);

  test('a later claim of the same id from another process loses', async () => {
    const [a, b] = [store(), store()];
    expect(await claimActivityId(a, 'https://fedizen.net/a/once')).toBe(true);
    expect(await claimActivityId(b, 'https://fedizen.net/a/once')).toBe(false);
  });
});

describe('fail-closed and regression guard', () => {
  test('a store without atomic cas() is refused', async () => {
    const noCas = { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async function* () {} } as unknown as KvStore;
    await expect(claimActivityId(noCas, 'x')).rejects.toThrow(/atomic/);
  });

  test('the old get-then-set approach really does race (deterministic interleaving)', async () => {
    // Both callers read before either writes: both would forward. Documents why cas() is required.
    const data = new Map<string, unknown>();
    let release!: () => void; const gate = new Promise<void>(r => (release = r));
    let reads = 0;
    const racy = async (id: string) => {
      const seen = data.get(id); reads++;
      if (reads === 2) release(); await gate;
      if (seen != null) return false; data.set(id, 1); return true;
    };
    const r = await Promise.all([racy('dup'), racy('dup')]);
    expect(r).toEqual([true, true]);
  });
});
