/**
 * Public lookups kept in Supabase (server only), so they outlive the server's memory.
 *
 * Staging runs with Railway App Sleeping: the service sleeps 5–10 min after its last outbound traffic and its memory
 * starts empty on every wake (nine wakes in nine hours on 25 Nov 2026). The in-memory caches for actors' avatars,
 * article credits and Voices to know then refill from dozens of other servers while the person waits. These helpers
 * are a second level behind those memory caches:
 * - read: one query for all the keys a page needs, given at most READ_BUDGET_MS; a slow or failing database just
 *   means the lookups go to the network as before;
 * - write: batched (WRITE_DELAY_MS) and fire-and-forget, never awaited by a page;
 * - public data only (table atlas_lookup_cache, supabase/migrations/20261125000000_lookup_cache.sql): never anything
 *   about an Atlas account or a Fedizen session;
 * - if the table isn't there yet (the migration not applied), it stops trying for 10 min at a time and says so once.
 */
export type LookupKind = 'avatar' | 'authors' | 'voices' | 'voice-avatars';

const READ_BUDGET_MS = 400;
const WRITE_DELAY_MS = 1000;
const MAX_KEY = 2048;
const MAX_VALUE_BYTES = 60_000;
const OFF_FOR_MS = 10 * 60_000;

let offUntil = 0;
let warned = false;
type Row = { kind: LookupKind; key: string; value: unknown; expires_at: string };
let queue: Row[] = [];
let flushing: ReturnType<typeof setTimeout> | null = null;

type Db = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
let dbFor: () => Promise<Db> = async () => (await import('@/integrations/supabase/client.server')).supabaseAdmin as unknown as Db;

function turnOff(why: string, code?: string) {
  offUntil = Date.now() + OFF_FOR_MS;
  if (!warned || code === '42P01') { warned = true; console.warn('Lookup cache unavailable', { why, code }); }
}

/** The kept values for `keys` that haven't expired. Missing or slow: an empty map, never an error. */
export async function readLookups<T>(kind: LookupKind, keys: readonly string[], now = Date.now()): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  const wanted = [...new Set(keys)].filter(k => k && k.length <= MAX_KEY).slice(0, 100);
  if (!wanted.length || now < offUntil) return out;
  const read = (async () => {
    const db = await dbFor();
    const { data, error } = await db.from('atlas_lookup_cache').select('key, value').eq('kind', kind).in('key', wanted).gt('expires_at', new Date(now).toISOString());
    if (error) { turnOff('read', error.code); return; }
    for (const r of (data ?? []) as { key: string; value: T }[]) out.set(r.key, r.value);
  })().catch(() => turnOff('read'));
  await Promise.race([read, new Promise(r => setTimeout(r, READ_BUDGET_MS))]);
  return new Map(out);
}

/** Keeps `value` for `key` until `ttlMs` from now. Batched; failures are ignored (the memory cache still has it). */
export function writeLookup(kind: LookupKind, key: string, value: unknown, ttlMs: number, now = Date.now()) {
  if (!key || key.length > MAX_KEY || now < offUntil) return;
  let size = 0;
  try { size = JSON.stringify(value).length; } catch { return; }
  if (size > MAX_VALUE_BYTES) return;
  queue.push({ kind, key, value, expires_at: new Date(now + ttlMs).toISOString() });
  if (queue.length > 500) queue = queue.slice(-500);
  flushing ??= setTimeout(() => void flush(), WRITE_DELAY_MS);
}

async function flush() {
  flushing = null;
  // One row per key: the latest write wins.
  const rows = [...new Map(queue.map(r => [`${r.kind}\n${r.key}`, r])).values()];
  queue = [];
  if (!rows.length) return;
  try {
    const db = await dbFor();
    const { error } = await db.from('atlas_lookup_cache').upsert(rows, { onConflict: 'kind,key' });
    if (error) return turnOff('write', error.code);
    // Now and then, drop what has expired, so the table stays small without a scheduled job.
    if (Math.random() < 0.05) await db.from('atlas_lookup_cache').delete().lt('expires_at', new Date().toISOString());
  } catch { turnOff('write'); }
}

/** For tests: a stand-in database, and a clean start. */
export function _setLookupDb(f: () => Promise<Db>) { dbFor = f; }
export async function _flushLookups() { if (flushing) clearTimeout(flushing); await flush(); }
export function _resetLookups() { offUntil = 0; warned = false; queue = []; if (flushing) clearTimeout(flushing); flushing = null; }
