/**
 * The on-device embedding model (embed.worker.ts), as one shared worker per tab: started only when the person has
 * turned it on, and its download state shared with Settings through a small store.
 */
import type { EmbedKind } from './vectors';
import type { Out } from './embed.worker';

export type LocalState =
  | { status: 'off' }
  | { status: 'downloading'; loaded: number; total: number }
  | { status: 'ready'; device: 'webgpu' | 'wasm' }
  | { status: 'failed'; reason: 'blocked' | 'unsupported' | 'download' };

let worker: Worker | null = null;
let state: LocalState = { status: 'off' };
const listeners = new Set<() => void>();
const waiting = new Map<number, { resolve: (v: Float32Array[]) => void; reject: () => void }>();
let next = 1;

function set(s: LocalState) { state = s; listeners.forEach(l => l()); }
export const localState = () => state;
export function onLocalState(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

/** Whether this browser can run it at all: module workers and WebAssembly. */
export const localSupported = () => typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';

/** Starts the worker and the model (downloading it the first time). */
export function startLocal() {
  if (worker || !localSupported()) return;
  worker = new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module', name: 'atlas-embeddings' });
  set({ status: 'downloading', loaded: 0, total: 0 });
  worker.onmessage = (e: MessageEvent<Out>) => {
    const m = e.data;
    if (m.type === 'progress') set({ status: 'downloading', loaded: m.loaded, total: m.total });
    else if (m.type === 'ready') set({ status: 'ready', device: m.device });
    else if (m.type === 'failed') { set({ status: 'failed', reason: m.reason }); stopLocal(false); }
    else if (m.type === 'embedded') { waiting.get(m.id)?.resolve(m.vectors); waiting.delete(m.id); }
    else if (m.type === 'error') { waiting.get(m.id)?.reject(); waiting.delete(m.id); }
  };
  worker.onerror = () => { set({ status: 'failed', reason: 'download' }); stopLocal(false); };
  worker.postMessage({ type: 'load' });
}

export function stopLocal(reset = true) {
  worker?.terminate();
  worker = null;
  waiting.forEach(w => w.reject());
  waiting.clear();
  if (reset) set({ status: 'off' });
}

/** Embeds texts on this device: unit vectors of 256 numbers. Rejects when the model isn't running. */
export function localEmbed(texts: string[], kind: EmbedKind): Promise<Float32Array[]> {
  if (!worker) return Promise.reject(new Error('off'));
  const id = next++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject: () => reject(new Error('failed')) });
    worker!.postMessage({ type: 'embed', id, texts, kind });
  });
}

/** Removes the downloaded model from the browser (Transformers.js keeps it in Cache Storage as "transformers-cache"). */
export async function removeLocalModel() {
  stopLocal();
  try { await caches.delete('transformers-cache'); } catch { /* not available: nothing kept */ }
}
