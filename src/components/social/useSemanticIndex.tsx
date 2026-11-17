import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { postText } from '@/lib/content-filter';
import type { EmbedKind } from '@/lib/semantic/vectors';
import { localEmbed, localState, localSupported, onLocalState, startLocal, stopLocal, type LocalState } from '@/lib/semantic/local-embedder';
import { useAtlasAuth } from './AuthState';
import { useAiRunner } from './useIntelligence';

/**
 * Atlas's semantic index (see src/lib/semantic): search by meaning over the posts you've been shown, emulating on the
 * web what ObjectBox's vector index does in a native app. Opt-in per device, with one of two engines:
 * - "device": Google's EmbeddingGemma running in this browser (downloaded once, ~200 MB); nothing leaves the device.
 * - "provider": the embedding model of the Intelligence key in use (OpenAI, Gemini, Mistral or Cloudflare), which sends
 *   the text of posts as they're indexed to that provider, as deep matching does for filters. Never direct messages.
 * The index itself, and the choice, stay on this device.
 */
export type Engine = 'device' | 'provider';

const PREF = (uid: string) => `atlas-semantic:${uid}`;
const PREF_EVENT = 'atlas-semantic-pref';
function readEngine(uid?: string): Engine | null {
  if (!uid) return null;
  try { const v = localStorage.getItem(PREF(uid)); return v === 'device' || v === 'provider' ? v : null; } catch { return null; }
}
export function setEngine(uid: string, engine: Engine | null) {
  try { if (engine) localStorage.setItem(PREF(uid), engine); else localStorage.removeItem(PREF(uid)); } catch { /* storage blocked: stays off */ }
  window.dispatchEvent(new Event(PREF_EVENT));
}
const onPref = (l: () => void) => { window.addEventListener(PREF_EVENT, l); window.addEventListener('storage', l); return () => { window.removeEventListener(PREF_EVENT, l); window.removeEventListener('storage', l); }; };

export function useEngine(): Engine | null {
  const { user } = useAtlasAuth();
  return useSyncExternalStore(onPref, () => readEngine(user?.id), () => null);
}
export const useLocalModel = (): LocalState => useSyncExternalStore(onLocalState, localState, () => ({ status: 'off' }) as LocalState);

export type Semantic = { ready: boolean; engine: Engine | null; model: string | null; embed: (texts: string[], kind: EmbedKind) => Promise<Float32Array[] | null> };

/** The engine in use, ready or not, and how to embed with it. */
export function useSemantic(): Semantic {
  const engine = useEngine();
  const local = useLocalModel();
  const runner = useAiRunner();
  const providerModel = runner.embeddingProvider ? (EMBEDDING_KEYS[runner.embeddingProvider] ?? null) : null;
  return useMemo((): Semantic => {
    if (engine === 'device') return {
      engine, model: LOCAL_INDEX_KEY, ready: local.status === 'ready',
      embed: (texts, kind) => localEmbed(texts, kind).catch(() => null),
    };
    if (engine === 'provider') return {
      engine, model: providerModel, ready: !!providerModel,
      embed: async (texts, kind) => (await runner.embed(texts, kind))?.vectors ?? null,
    };
    return { engine: null, model: null, ready: false, embed: async () => null };
  }, [engine, local.status, providerModel, runner]);
}

// Index keys, mirrored from intelligence/embeddings.ts so this module stays light (that one is loaded on demand).
const LOCAL_INDEX_KEY = 'embeddinggemma-300m:256';
const EMBEDDING_KEYS: Record<string, string> = {
  openai: 'openai:text-embedding-3-small:256', google: 'google:gemini-embedding-2:256', mistral: 'mistral:mistral-embed', cloudflare: 'embeddinggemma-300m:256',
};

/* ── Indexing the posts you're shown ───────────────────────────────────────────────────────────── */

const queue = new Map<string, FedizenPost>();
let flushing = false;
let current: { uid: string; s: Semantic } | null = null;

/** Queues a post shown in a feed for the index (no-op unless an engine is ready). Direct messages never are. */
export function queueForIndex(p: FedizenPost) {
  if (!current?.s.ready || !p.statusId || p.visibility === 'direct' || queue.has(p.id)) return;
  queue.set(p.id, p);
  if (queue.size > 200) queue.delete(queue.keys().next().value as string);
  void flush();
}

async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    const store = await import('@/lib/semantic/index-store');
    while (queue.size && current?.s.ready && current.s.model) {
      await new Promise(r => setTimeout(r, 1500));
      const { uid, s } = current ?? {};
      if (!uid || !s?.model) break;
      const batch = [...queue.values()].slice(0, 16);
      batch.forEach(p => queue.delete(p.id));
      const have = await store.indexed(uid, s.model, batch.map(p => p.id));
      const todo = batch.filter(p => !have.has(p.id)).map(p => ({ p, text: postText(p, 1500) })).filter(x => x.text.length >= 12);
      if (!todo.length) continue;
      const vecs = await s.embed(todo.map(x => x.text), 'document');
      if (!vecs || vecs.length !== todo.length) break; // the engine failed: stop until the next post is shown
      await store.addToIndex(uid, s.model, todo.map((x, i) => ({ id: x.p.id, vec: vecs[i], post: x.p })));
    }
  } catch { /* storage blocked or full: the index is a convenience */ } finally { flushing = false; }
}

/**
 * Mounted once per app (DesktopHosts, AtlasMobileApp): keeps the chosen engine running for the indexer, starting the
 * on-device model (from the browser's cache after the first download) when that's the engine.
 */
export function SemanticIndexer() {
  const { user } = useAtlasAuth();
  const s = useSemantic();
  useEffect(() => {
    if (s.engine === 'device' && localSupported()) startLocal();
    if (s.engine !== 'device') stopLocal();
  }, [s.engine]);
  useEffect(() => { current = user ? { uid: user.id, s } : null; if (current?.s.ready) void flush(); }, [user, s]);
  return null;
}

/** Similarity below which a post isn't offered as related. Cosine scores differ by model; this is a floor, not a tuning. */
const MIN_SCORE = 0.35;

/** Posts you've been shown that mean much the same as a search, best first (only with an engine ready). */
export function useSeenPostsLike(q: string) {
  const { user } = useAtlasAuth();
  const s = useSemantic();
  const term = q.trim();
  const r = useQuery({
    queryKey: ['semantic-seen', user?.id, s.model, term.toLowerCase()],
    queryFn: async () => {
      const [v] = (await s.embed([term], 'query')) ?? [];
      if (!v) return [];
      const { searchIndex } = await import('@/lib/semantic/index-store');
      return searchIndex<FedizenPost>(user!.id, s.model!, v, 12, MIN_SCORE);
    },
    enabled: !!user && s.ready && !!s.model && term.length >= 2, staleTime: 60_000,
  });
  return { posts: r.data ?? [], loading: r.isFetching, on: s.ready };
}
