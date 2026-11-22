/**
 * Atlas's semantic index on the web: what ObjectBox's on-device vector index does in a native app, kept in this
 * browser's IndexedDB. Browser-only.
 *
 * Each entry is a post the person was shown (feeds, groups, profiles, search), its unit vector from one embedding
 * model, and the post itself so a search can show it again. Entries are kept per Atlas user and per model (vectors of
 * different models can't be compared); the oldest go first past MAX_PER_INDEX. Nothing here leaves the device: a
 * search reads it in place (a full scan; see vectors.ts). Signing out of Atlas, or "Clear" in Settings, empties it.
 */
import { nearest } from './vectors';

const DB = 'atlas-semantic', VERSION = 1, STORE = 'posts';
export const MAX_PER_INDEX = 4000;

export type IndexedPost<P> = { key: string; uid: string; model: string; id: string; at: number; vec: Float32Array; post: P };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: 'key' });
      s.createIndex('index', ['uid', 'model', 'at']);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const keyOf = (uid: string, model: string, id: string) => `${uid}|${model}|${id}`;
const range = (uid: string, model: string) => IDBKeyRange.bound([uid, model, -Infinity], [uid, model, Infinity]);

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => T): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

export const indexSupported = () => typeof indexedDB !== 'undefined';

/** Which of these post ids this index already holds. */
export async function indexed(uid: string, model: string, ids: string[]): Promise<Set<string>> {
  const have = new Set<string>();
  await run('readonly', s => { for (const id of ids) { const r = s.getKey(keyOf(uid, model, id)); r.onsuccess = () => { if (r.result !== undefined) have.add(id); }; } });
  return have;
}

/** The stored vectors of these posts, by post id (those not in the index are missing). */
export async function vectorsOf(uid: string, model: string, ids: string[]): Promise<Map<string, Float32Array>> {
  const out = new Map<string, Float32Array>();
  await run('readonly', s => { for (const id of ids) { const r = s.get(keyOf(uid, model, id)); r.onsuccess = () => { const v = r.result as IndexedPost<unknown> | undefined; if (v) out.set(id, v.vec); }; } });
  return out;
}

/** Adds posts with their vectors, then trims the oldest past the cap. */
export async function addToIndex<P>(uid: string, model: string, items: { id: string; vec: Float32Array; post: P }[]) {
  if (!items.length) return;
  const at = Date.now();
  await run('readwrite', s => {
    items.forEach((it, i) => s.put({ key: keyOf(uid, model, it.id), uid, model, id: it.id, at: at + i, vec: it.vec, post: it.post } satisfies IndexedPost<P>));
    const count = s.index('index').count(range(uid, model));
    count.onsuccess = () => {
      let extra = count.result - MAX_PER_INDEX;
      if (extra <= 0) return;
      const cur = s.index('index').openCursor(range(uid, model));
      cur.onsuccess = () => { const c = cur.result; if (c && extra-- > 0) { c.delete(); c.continue(); } };
    };
  });
}

/** The posts nearest a search's vector, best first. */
export async function searchIndex<P>(uid: string, model: string, q: Float32Array, k: number, min: number): Promise<{ post: P; score: number }[]> {
  const all: IndexedPost<P>[] = [];
  await run('readonly', s => { const r = s.index('index').getAll(range(uid, model)); r.onsuccess = () => all.push(...(r.result as IndexedPost<P>[])); });
  return nearest(q, all, k, min).map(h => ({ post: h.item.post, score: h.score }));
}

/** How many posts this person's index holds for a model. */
export async function indexSize(uid: string, model: string): Promise<number> {
  let n = 0;
  await run('readonly', s => { const r = s.index('index').count(range(uid, model)); r.onsuccess = () => { n = r.result; }; });
  return n;
}

/** Empties this person's index, every model. */
export async function clearIndex(uid: string) {
  await run('readwrite', s => {
    const cur = s.index('index').openCursor(IDBKeyRange.bound([uid, '', -Infinity], [uid, '￿', Infinity]));
    cur.onsuccess = () => { const c = cur.result; if (c) { c.delete(); c.continue(); } };
  });
}
