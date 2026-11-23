import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { postText } from '@/lib/content-filter';
import { dot, type EmbedKind } from '@/lib/semantic/vectors';
import type { ContentFilter } from '@/lib/content-filter';
import type { Similar } from '@/lib/filter-engine';
import { localEmbed, localState, localSupported, onLocalState, startLocal, stopLocal, type LocalState } from '@/lib/semantic/local-embedder';
import { useAtlasAuth } from './AuthState';
import { useAiRunner } from './useIntelligence';
import { EMBEDDING_INDEX_KEYS } from '@/lib/semantic/embedding-keys';

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

const LOCAL_INDEX_KEY = 'embeddinggemma-300m:256';
const EMBEDDING_KEYS: Record<string, string> = EMBEDDING_INDEX_KEYS;

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

/* ── Keyword filters by meaning ────────────────────────────────────────────────────────────────── */

/**
 * Cosine floors for filters. A post at or above NEAR goes to the AI model to confirm (when there is one); at or above
 * CLOSE it's filtered even without one. Starting values for EmbeddingGemma-style query/document scores, not tuned.
 */
export const FILTER_NEAR = 0.4, FILTER_CLOSE = 0.55;

const filterVectors = new Map<string, Float32Array[]>();

/**
 * The filter engine's `similar` (filter-engine.ts) for the engine in use: each filter checked in context is embedded
 * once as a search (its words and its wordings); each post uses its vector from the index when it's there, and is
 * embedded otherwise. Null when the engine isn't ready.
 */
export function makeSimilar(uid: string, s: Semantic): Similar | undefined {
  if (!s.ready || !s.model) return undefined;
  const model = s.model;
  return async (posts, filters) => {
    const wanted = filters.filter(f => f.semantic);
    if (!wanted.length || !posts.length) return posts.map(p => ({ n: p.n, matches: [] }));
    const fv = await Promise.all(wanted.map(async (f: ContentFilter) => {
      const texts = [f.text, ...(f.expansions ?? []).slice(0, 8)].map(t => t.replace(/^#/, '')).filter(Boolean);
      const key = `${model}|${f.id}|${texts.join('\u0001')}`;
      let v = filterVectors.get(key);
      if (!v) { v = (await s.embed(texts, 'query')) ?? undefined; if (v) { if (filterVectors.size > 300) filterVectors.clear(); filterVectors.set(key, v); } }
      return { id: f.id, v };
    }));
    if (fv.some(x => !x.v)) return null;
    const store = await import('@/lib/semantic/index-store');
    const known = await store.vectorsOf(uid, model, posts.map(p => p.id)).catch(() => new Map<string, Float32Array>());
    const missing = posts.filter(p => !known.has(p.id) && p.text.length >= 12);
    if (missing.length) {
      const got = await s.embed(missing.map(p => p.text), 'document');
      if (!got || got.length !== missing.length) return null;
      missing.forEach((p, i) => known.set(p.id, got[i]));
    }
    return posts.map(p => {
      const pv = known.get(p.id);
      if (!pv) return { n: p.n, matches: [] };
      const matches = fv.map(f => ({ id: f.id, score: Math.max(...f.v!.map(v => dot(v, pv))) }))
        .filter(m => m.score >= FILTER_NEAR).map(m => ({ id: m.id, strong: m.score >= FILTER_CLOSE }));
      return { n: p.n, matches };
    });
  };
}
