import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
  addContentFilters, deleteContentFilter, describePostForFilter, expandContentFilter, followingAmong, getIntelligence, judgeFilteredPosts,
  listContentFilters, removeAiKey, saveAiKey, updateAiKey, suggestContentFilters, altTextForImage, embedTextsFor, searchWordingsFor, updateContentFilter, updateIntelligence,
  type AiProblem, type IntelligenceStatus,
} from '@/lib/intelligence.functions';
import { getFedizenStatus } from '@/lib/fedizen.functions';
import { translateWithAi } from '@/lib/translation.functions';
import { FilterEngine, type FollowLookup, type Judge } from '@/lib/filter-engine';
import { FILTER_PLACES, lintFilters, type ContentFilter, type FilterAction, type FilterablePost, type FilterPlace, type Verdict } from '@/lib/content-filter';
import { PROVIDERS, type Credential, type ProviderId } from '@/lib/intelligence/providers';
import type { DeviceKey, DevicePrefs } from '@/lib/intelligence/device-keys';
import type { ImageInput } from '@/lib/intelligence/llm';
import { EMBEDDING_INDEX_KEYS } from '@/lib/semantic/embedding-keys';
import { useAtlasAuth } from './AuthState';
import { forgetFilterStats, recordFiltered } from '@/lib/filter-stats';
import { makeSimilar, useSemantic } from './useSemanticIndex';

export const AI_PROBLEM: Record<AiProblem, string> = {
  'not-configured': 'Intelligence isn’t set up on this Atlas server yet.',
  'not-ready': 'Turn on Intelligence and add a key first.',
  'bad-key': 'The provider says that key isn’t valid or is turned off. Check it and try again.',
  'no-credit': 'The provider says that account has no credit left. Add credit there and try again.',
  'no-access': 'That key can’t use any chat models. Check its permissions with the provider.',
  'rate-limited': 'The provider is limiting requests on this key. Try again in a minute.',
  unavailable: 'The provider didn’t answer. Try again.',
  'bad-output': 'The model’s answer couldn’t be used. Try again, or choose another model.',
  'bad-model': 'That model isn’t available to this key, or can’t do this. Choose another in Settings → Intelligence.',
  'browser-blocked': 'This provider doesn’t accept requests straight from a browser. Keep this key on Atlas’s server instead.',
  'no-vision': 'Your AI model can’t read images. Choose one that can in Settings → Intelligence.',
  storage: 'Atlas couldn’t save that. Try again.',
};

const statusKey = (id?: string) => ['intelligence', id] as const;
const deviceKey = (id?: string) => ['intelligence-device', id] as const;
const filtersKey = (id?: string) => ['content-filters', id] as const;
const device = () => import('@/lib/intelligence/device-keys');
const tasks = () => import('@/lib/intelligence/tasks');

/** Where the key in use lives, which provider and model it is, and which saved key (on Atlas's server or here). */
export type ActiveAi = { where: 'server' | 'device'; provider: ProviderId; model: string; keyId?: string };
export type Intelligence = IntelligenceStatus & { deviceKeys: DeviceKey[]; devicePrefs: DevicePrefs; active: ActiveAi | null };

/** Intelligence settings: whether it's on, saved keys (last four characters only, on the server or this device), and
 *  which key and model are in use. A key kept on this device, when chosen, wins over one on the server. */
export function useIntelligence() {
  const { user } = useAtlasAuth();
  const read = useServerFn(getIntelligence);
  const server = useQuery({ queryKey: statusKey(user?.id), queryFn: () => read(), enabled: !!user, staleTime: 5 * 60_000 });
  const local = useQuery({
    queryKey: deviceKey(user?.id), enabled: !!user, staleTime: Infinity,
    queryFn: async () => { const d = await device(); return { keys: await d.deviceKeys(user!.id), prefs: await d.devicePrefs(user!.id) }; },
  });
  const data = useMemo((): Intelligence | undefined => {
    if (!server.data) return undefined;
    const keys = local.data?.keys ?? [], prefs = local.data?.prefs ?? null;
    const dev = prefs && keys.find(k => k.id === (prefs.keyId ?? prefs.provider));
    const active: ActiveAi | null = dev ? { where: 'device', provider: dev.provider, keyId: dev.id, model: dev.models.includes(prefs.model) ? prefs.model : dev.models[0] }
      : server.data.provider && server.data.model ? { where: 'server', provider: server.data.provider, model: server.data.model, ...(server.data.mainKey ? { keyId: server.data.mainKey } : {}) } : null;
    return { ...server.data, deviceKeys: keys, devicePrefs: prefs, active };
  }, [server.data, local.data]);
  return { data, isLoading: server.isLoading || local.isLoading };
}

/** True when filters and the assistant can use AI right now. */
/**
 * Why an AI setting can't be switched on yet, or null when it can: no AI turned on, no key that chats (embeddings-only
 * keys don't), or, for the assistant, a key kept only on this device.
 */
export function whyUnavailable(s: Intelligence | undefined, needsServerKey = false): string | null {
  if (!s?.available) return null;
  if (!s.active) return 'Add a key from Anthropic, OpenAI, Google, Mistral, Kimi or Cloudflare first. Keys for semantic filters only can’t chat.';
  if (!s.enabled) return 'Turn on Use AI in Atlas first.';
  if (needsServerKey && s.active.where !== 'server') return 'Needs a key kept on Atlas’s server.';
  return null;
}

export const intelligenceReady = (s?: Intelligence | IntelligenceStatus) => !!s?.available && s.enabled && ('active' in s ? !!s.active : !!s.provider && !!s.model);

const problemOf = async (e: unknown): Promise<AiProblem> => {
  const { ProviderError } = await import('@/lib/intelligence/llm');
  if (e instanceof ProviderError) return e.code;
  if (e instanceof Error && e.message === 'bad-output') return 'bad-output';
  if (e instanceof Error && e.message === 'not-ready') return 'not-ready';
  return 'unavailable';
};

/** A saved key, on this device or on Atlas's server. */
export type KeyRef = { where: 'device' | 'server'; keyId: string };

export function useIntelligenceActions() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const save = useServerFn(saveAiKey), remove = useServerFn(removeAiKey), update = useServerFn(updateIntelligence), edit = useServerFn(updateAiKey);
  const [busy, setBusy] = useState(false);
  const id = user?.id ?? '';
  const put = (s: IntelligenceStatus) => { qc.setQueryData(statusKey(user?.id), s); void qc.invalidateQueries({ queryKey: filtersKey(user?.id) }); };
  const refreshDevice = () => qc.invalidateQueries({ queryKey: deviceKey(user?.id) });
  const run = async <T,>(fn: () => Promise<T>) => { setBusy(true); try { return await fn(); } finally { setBusy(false); } };
  return {
    busy,
    /** Null when saved, else what went wrong. The key itself isn't kept anywhere in the page afterwards. */
    saveKey: (provider: ProviderId, key: string, account: string | undefined, where: 'server' | 'device', label?: string) => run(async (): Promise<string | null> => {
      if (where === 'device') {
        try {
          const d = await device();
          const saved = await d.saveDeviceKey(id, { provider, key, ...(account ? { account } : {}) }, label);
          if (PROVIDERS[provider].embeddingsOnly) { await refreshDevice(); return null; }
          if (!saved.models.length) { await d.removeDeviceKey(id, saved.id); return AI_PROBLEM['no-access']; }
          if (!(await d.devicePrefs(id))) await d.setDevicePrefs(id, { keyId: saved.id, provider, model: saved.models[0] });
          await refreshDevice(); return null;
        } catch (e) { return AI_PROBLEM[await problemOf(e)]; }
      }
      try {
        const r = await save({ data: { expectedAtlasUserId: id, provider, key, ...(account ? { account } : {}), ...(label?.trim() ? { label: label.trim().slice(0, 40) } : {}) } });
        if ('error' in r) return AI_PROBLEM[r.error];
        put(r.status); return null;
      } catch { return AI_PROBLEM.unavailable; }
    }),
    /** Removes a key, on this device or on Atlas's server, by its id. */
    removeKey: (k: KeyRef) => run(async () => {
      if (k.where === 'device') { await (await device()).removeDeviceKey(id, k.keyId); await refreshDevice(); return; }
      put(await remove({ data: { expectedAtlasUserId: id, keyId: k.keyId } }));
    }),
    /** Picks the main key: one on this device, or a saved one on Atlas's server (clearing the device choice). */
    choose: (k: KeyRef, model?: string) => run(async () => {
      const d = await device();
      if (k.where === 'device') {
        const dk = (await d.deviceKeys(id)).find(x => x.id === k.keyId);
        if (dk) await d.setDevicePrefs(id, { keyId: dk.id, provider: dk.provider, model: model && dk.models.includes(model) ? model : dk.models[0] });
      } else {
        await d.setDevicePrefs(id, null);
        put(await update({ data: { expectedAtlasUserId: id, main: { key: k.keyId, ...(model ? { model } : {}) } } }));
      }
      await refreshDevice();
    }),
    /** Background filtering's own key and model, or null to use the main ones. */
    setBackground: (choice: { key: string; model?: string } | null) => run(async () => { put(await update({ data: { expectedAtlasUserId: id, background: choice } })); }),
    /** A saved key's name, or (on Atlas's server) the model it uses as a backup. */
    editKey: (k: KeyRef, patch: { label?: string | null; model?: string }) => run(async () => {
      if (k.where === 'device') { if (patch.label !== undefined) await (await device()).renameDeviceKey(id, k.keyId, patch.label); await refreshDevice(); return; }
      put(await edit({ data: { expectedAtlasUserId: id, keyId: k.keyId, ...patch } }));
    }),
    update: (patch: { enabled?: boolean; deepMatching?: boolean; fallback?: boolean }) => run(async () => { put(await update({ data: { expectedAtlasUserId: id, ...patch } })); }),
  };
}

/* ── Running AI tasks with whichever key is in use ───────────────────────────────────────────── */

type Suggestions = import('@/lib/intelligence/tasks').FilterSuggestions;

/** The AI tasks, routed to Atlas's server (key kept there) or run in this browser (key kept on this device). */
export function useAiRunner() {
  const { user } = useAtlasAuth();
  const ai = useIntelligence().data;
  const judgeServer = useServerFn(judgeFilteredPosts), expandServer = useServerFn(expandContentFilter);
  const suggestServer = useServerFn(suggestContentFilters), describeServer = useServerFn(describePostForFilter);
  const altServer = useServerFn(altTextForImage), wordingsServer = useServerFn(searchWordingsFor), embedServer = useServerFn(embedTextsFor);
  const translateServer = useServerFn(translateWithAi);
  const id = user?.id ?? '';
  const active = ai?.active ?? null, ready = intelligenceReady(ai), deep = !!ai?.deepMatching;
  const backup = !!ai?.fallback, deviceList = ai?.deviceKeys;
  /**
   * Where semantic filters and the semantic index get embeddings: the place in use (this device or Atlas's server),
   * or, with no chat key anywhere, a device key added for embeddings. On a device: a key added for embeddings only
   * first, then the key in use, then the others (the server's order, roles.ts embeddingPick). One key, no backups.
   */
  const embedding = useMemo((): { where: 'device'; provider: ProviderId; keyId: string } | { where: 'server'; provider: ProviderId } | null => {
    const rank = (k: DeviceKey) => (PROVIDERS[k.provider].embeddingsOnly ? 0 : k.id === active?.keyId ? 1 : 2);
    const dev = (deviceList ?? []).filter(k => k.provider in EMBEDDING_INDEX_KEYS && k.provider !== 'cloudflare').sort((a, b) => rank(a) - rank(b))[0];
    if (active?.where === 'device' || (!active && dev)) return dev ? { where: 'device', provider: dev.provider, keyId: dev.id } : null;
    return ai?.embeddingProvider ? { where: 'server', provider: ai.embeddingProvider } : null;
  }, [deviceList, active, ai?.embeddingProvider]);
  /**
   * Runs a job with the device key in use, then (with backup on) this device's other keys in the order added, each
   * with its first listed model. Throws the first key's error; Error('not-ready') when there's no device key in use.
   */
  const onDevice = useCallback(async <T,>(job: (c: Credential, model: string) => Promise<T>, allowBackup = true): Promise<T> => {
    if (!ready || active?.where !== 'device' || !active.keyId) throw new Error('not-ready');
    const others = allowBackup && backup ? (deviceList ?? []).filter(k => k.id !== active.keyId && k.models[0]).map(k => ({ id: k.id, model: k.models[0] })) : [];
    const d = await device(), { ProviderError } = await import('@/lib/intelligence/llm');
    let first: unknown = null;
    for (const k of [{ id: active.keyId, model: active.model }, ...others]) {
      const c = await d.deviceCredential(id, k.id);
      if (!c) continue;
      try { return await job(c, k.model); } catch (e) {
        first ??= e;
        if (!(e instanceof ProviderError) || !['rate-limited', 'unavailable', 'bad-key', 'no-access', 'no-credit', 'bad-model', 'no-vision'].includes(e.code)) break;
      }
    }
    throw first ?? new Error('not-ready');
  }, [ready, active, id, backup, deviceList]);
  return useMemo(() => ({
    ready, where: active?.where ?? null,
    judge: (filters: ContentFilter[]): Judge => async posts => {
      if (active?.where === 'device') {
        try { return await onDevice(async (c, model) => (await tasks()).judgeWith(c, model, filters, posts, deep)); } catch { return null; }
      }
      const r = await judgeServer({ data: { posts } }); return 'error' in r ? null : r.verdicts;
    },
    /** Other wordings for a filter: kept by the server, or worked out here and then saved with the filter. */
    expand: async (f: ContentFilter): Promise<{ filters?: ContentFilter[]; expansions?: string[]; error?: AiProblem }> => {
      if (active?.where === 'device') {
        try { return { expansions: await onDevice(async (c, model) => (await tasks()).expandFilter(c, model, f)) }; } catch (e) { return { error: await problemOf(e) }; }
      }
      const r = await expandServer({ data: { expectedAtlasUserId: id, id: f.id } }).catch(() => ({ error: 'unavailable' as const }));
      return 'error' in r ? { error: r.error } : { filters: r.filters };
    },
    suggest: async (filters: ContentFilter[]): Promise<Suggestions | { error: AiProblem }> => {
      if (active?.where === 'device') {
        try { return await onDevice(async (c, model) => (await tasks()).suggestFilters(c, model, filters)); } catch (e) { return { error: await problemOf(e) }; }
      }
      const r = await suggestServer({ data: { expectedAtlasUserId: id } }).catch(() => ({ error: 'unavailable' as const }));
      return r as Suggestions | { error: AiProblem };
    },
    describe: async (text: string): Promise<{ filter: string } | { error: AiProblem }> => {
      if (active?.where === 'device') {
        try { return { filter: await onDevice(async (c, model) => (await tasks()).describePost(c, model, text)) }; } catch (e) { return { error: await problemOf(e) }; }
      }
      return describeServer({ data: { expectedAtlasUserId: id, text } }).catch(() => ({ error: 'unavailable' as const }));
    },
    /** Alt text for an image about to be posted (the model must read images): on this device or Atlas's server. */
    altText: async (image: ImageInput, text: string): Promise<{ alt: string } | { error: AiProblem }> => {
      if (active?.where === 'device') {
        try { return { alt: await onDevice(async (c, model) => (await tasks()).writeAltText(c, model, image, text)) }; } catch (e) { return { error: await problemOf(e) }; }
      }
      return altServer({ data: { expectedAtlasUserId: id, image, text } }).catch(() => ({ error: 'unavailable' as const }));
    },
    /** Other searches meaning the same as `q` (post search): with the key on this device, or on Atlas's server. */
    searchWordings: async (q: string): Promise<string[]> => {
      if (active?.where === 'device') {
        try { return await onDevice(async (c, model) => (await tasks()).searchWordings(c, model, q)); } catch { return []; }
      }
      const r = await wordingsServer({ data: { expectedAtlasUserId: id, q } }).catch(() => null);
      return r && 'terms' in r ? r.terms : [];
    },
    /** Embeddings with the key in use, for the semantic index; null when it fails or the provider has none. */
    embed: async (texts: string[], kind: 'query' | 'document'): Promise<{ key: string; vectors: Float32Array[] } | null> => {
      if (!ai?.enabled || !embedding) return null;
      if (embedding.where === 'device') {
        const { EMBEDDING_MODELS, embedWith } = await import('@/lib/intelligence/embeddings');
        const m = EMBEDDING_MODELS[embedding.provider];
        const c = m ? await (await device()).deviceCredential(id, embedding.keyId) : null;
        if (!m || !c) return null;
        try { return { key: m.key, vectors: await embedWith(c, texts, kind) }; } catch { return null; }
      }
      const r = await embedServer({ data: { expectedAtlasUserId: id, texts, kind } }).catch(() => null);
      return r && 'vectors' in r ? { key: r.key, vectors: r.vectors.map(v => Float32Array.from(v)) } : null;
    },
    /** The provider in use, when it has an embedding model (Anthropic and Kimi don't). */
    embeddingProvider: ai?.enabled ? embedding?.provider ?? null : null,
    /** Which model answers, so answers cached for one model aren't reused for another. */
    model: active ? `${active.where}:${active.provider}:${active.model}` : null,
    /** Which model checks posts against filters (background work: its own model on Atlas's server when chosen). */
    judgeModel: !active ? null : active.where === 'server' && ai?.background ? `server:${ai.background.provider}:${ai.background.model}` : `${active.where}:${active.provider}:${active.model}`,
    /** Translation (lib/translation) with the key in use: on this device or Atlas's server. */
    translate: async (req: { texts: string[]; target: string; source?: string }): Promise<{ texts: string[]; detected?: string } | { error: string }> => {
      if (!ready) return { error: 'no-key' };
      if (active?.where === 'device') {
        try { return await onDevice(async (c, model) => (await tasks()).translateTexts(c, model, req)); } catch (e) { return { error: await problemOf(e) }; }
      }
      return translateServer({ data: { expectedAtlasUserId: id, ...req } }).catch(() => ({ error: 'unavailable' as const }));
    },
  }), [ready, active, deep, onDevice, embedding, ai?.enabled, judgeServer, expandServer, suggestServer, describeServer, altServer, wordingsServer, embedServer, translateServer, id, ai?.embeddingProvider, ai?.background]);
}

/* ── Keyword filters ─────────────────────────────────────────────────────────────────────────── */

/** The person's keyword filters (Atlas keeps them; Fedizen's list has no API to read yet). */
export function useContentFilters(strictDiscovery = false) {
  const { user } = useAtlasAuth();
  const read = useServerFn(listContentFilters);
  return useQuery({
    queryKey: filtersKey(user?.id), queryFn: () => read(), enabled: !!user,
    staleTime: strictDiscovery ? 30_000 : 5 * 60_000,
    ...(strictDiscovery ? { refetchOnWindowFocus: 'always' as const, refetchInterval: 2 * 60_000 } : {}),
  });
}

export type FilterOptions = { action: FilterAction; places: FilterPlace[]; expiresAt: string | null; exceptFollowing: boolean };
export const DEFAULT_OPTIONS: FilterOptions = { action: 'hide', places: [...FILTER_PLACES], expiresAt: null, exceptFollowing: false };

export function useFilterActions() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const runner = useAiRunner();
  const add = useServerFn(addContentFilters), change = useServerFn(updateContentFilter), del = useServerFn(deleteContentFilter);
  const id = user?.id ?? '';
  const put = (filters: ContentFilter[]) => qc.setQueryData(filtersKey(user?.id), { filters });
  const current = () => qc.getQueryData<{ filters?: ContentFilter[] }>(filtersKey(user?.id))?.filters ?? [];
  const widenOne = async (f: ContentFilter): Promise<AiProblem | null> => {
    const r = await runner.expand(f);
    if (r.error) return r.error;
    if (r.filters) put(r.filters);
    else if (r.expansions) put((await change({ data: { expectedAtlasUserId: id, id: f.id, expansions: r.expansions } })).filters);
    return null;
  };
  /** New filters checked in context get their other wordings from the AI model, one at a time, in the background. */
  const widen = async (filters: ContentFilter[], ids: Set<string>) => {
    if (!runner.ready) return;
    for (const f of filters) {
      if (!ids.has(f.id) || !f.semantic || f.expansions.length) continue;
      if (await widenOne(f)) break;
    }
  };
  return {
    add: async (texts: string[], options: FilterOptions): Promise<string | null> => {
      try {
        const before = new Set(current().map(f => f.id));
        const r = await add({ data: { expectedAtlasUserId: id, texts, ...options } });
        if ('error' in r) return AI_PROBLEM[r.error];
        put(r.filters);
        void widen(r.filters, new Set(r.filters.filter(f => !before.has(f.id)).map(f => f.id)));
        return null;
      } catch { return AI_PROBLEM.storage; }
    },
    /** Changes a filter; new words drop its old wordings and ask for new ones. Says why it couldn't, if it couldn't. */
    update: async (filterId: string, patch: Partial<FilterOptions> & { text?: string; semantic?: boolean; expansions?: string[] }): Promise<string | null> => {
      try {
        const r = await change({ data: { expectedAtlasUserId: id, id: filterId, ...patch } });
        put(r.filters);
        if (r.taken) return 'Another filter already has those words.';
        if (patch.semantic || patch.text !== undefined) void widen(r.filters, new Set([filterId]));
        return null;
      } catch { return AI_PROBLEM.storage; }
    },
    remove: async (filterId: string) => { put((await del({ data: { expectedAtlasUserId: id, id: filterId } })).filters); forgetFilterStats(id, filterId); },
    /** Re-asks for a filter's other wordings. */
    widen: async (filterId: string): Promise<string | null> => {
      const f = current().find(x => x.id === filterId);
      if (!f) return null;
      const p = await widenOne(f);
      return p ? AI_PROBLEM[p] : null;
    },
    suggest: () => runner.suggest(current()),
    describe: (text: string) => runner.describe(text),
  };
}

/** Problems a filter list has from its wording alone, by filter id (no AI needed). */
export function useFilterCautions(filters: ContentFilter[]) {
  return useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of lintFilters(filters)) m.set(c.filterId, [...(m.get(c.filterId) ?? []), c.issue]);
    return m;
  }, [filters]);
}

/* ── Applying filters in every feed ──────────────────────────────────────────────────────────── */

type FilterEnv = { engine: FilterEngine; me: string | null; product: string | null ; following: FollowLookup; /** Atlas account, for filter counts. */ account: string | null };
const EngineContext = createContext<FilterEnv | null>(null);
const PlaceContext = createContext<FilterPlace>('home');

/** Marks where the posts under it are shown (home by default), for filters that apply only in some places. */
export function FilterPlaceProvider({ place, children }: { place: FilterPlace; children: ReactNode }) {
  return <PlaceContext.Provider value={place}>{children}</PlaceContext.Provider>;
}

/** Asks Fedizen, 40 accounts at a time, whether the person follows the authors that filters need to know about. */
function useFollowLookup(engine: FilterEngine): FollowLookup {
  const { user } = useAtlasAuth();
  const ask = useServerFn(followingAmong);
  const known = useRef(new Map<string, boolean>()), waiting = useRef(new Set<string>()), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { known.current.clear(); waiting.current.clear(); }, [user?.id]);
  return useMemo(() => ({
    get: (accountId: string) => known.current.get(accountId),
    request: (accountId: string) => {
      if (!user || known.current.has(accountId) || waiting.current.has(accountId)) return;
      waiting.current.add(accountId);
      if (timer.current) return;
      timer.current = setTimeout(async () => {
        timer.current = null;
        const ids = [...waiting.current];
        for (let i = 0; i < ids.length; i += 40) {
          const batch = ids.slice(i, i + 40);
          const r = await ask({ data: { expectedAtlasUserId: user.id, ids: batch } }).catch(() => null);
          // Unknown (not connected, or Fedizen didn't answer) counts as not followed: the filter still applies.
          for (const a of batch) { known.current.set(a, !!(r && 'following' in r && r.following[a])); waiting.current.delete(a); }
        }
        engine.refresh();
      }, 150);
    },
  }), [user, ask, engine]);
}

/** Runs the person's filters over every post card under it. Mounted once at the root. */
export function ContentFilterProvider({ children }: { children: ReactNode }) {
  const { user } = useAtlasAuth();
  const [engine] = useState(() => new FilterEngine());
  const filters = useContentFilters();
  const ai = useIntelligence().data;
  const runner = useAiRunner();
  const following = useFollowLookup(engine);
  const semantic = useSemantic();
  const similar = useMemo(() => (user ? makeSimilar(user.id, semantic) : undefined), [user, semantic]);
  const statusFn = useServerFn(getFedizenStatus);
  const fedizen = useQuery({ queryKey: ['fedizen-status', user?.id], queryFn: () => statusFn(), enabled: !!user, staleTime: 60_000 });
  const list = useMemo(() => (user && filters.data && 'filters' in filters.data ? filters.data.filters : []), [user, filters.data]);
  useEffect(() => {
    engine.configure({ filters: list, ai: runner.ready, deep: !!ai?.deepMatching, scope: `${user?.id}:${runner.judgeModel ?? runner.where}:${semantic.model ?? ''}`, judge: runner.judge(list), similar, following });
  }, [engine, list, runner, ai?.deepMatching, user?.id, following, similar, semantic.model]);
  const env = useMemo(() => ({ engine, me: fedizen.data?.handle ?? null, product: ai?.active ? PROVIDERS[ai.active.provider].product : null, following, account: user?.id ?? null }), [engine, fedizen.data?.handle, ai?.active, following, user?.id]);
  return <EngineContext.Provider value={env}>{children}</EngineContext.Provider>;
}

/** Whether a post is the person's own: its handle is their Fedizen handle (local posts carry no domain). */
export function isOwnPost(postHandle: string | undefined, myHandle: string | null): boolean {
  if (!postHandle || !myHandle) return false;
  const norm = (h: string) => h.replace(/^@/, '').toLowerCase().replace(/@fedizen\.net$/, '');
  return norm(postHandle) === norm(myHandle);
}

/**
 * Of these posts, the ids a filter hides or warns on in `place` (no notice is drawn; for counts like Activity's badge,
 * which shouldn't count what Activity leaves out). Blurred posts stay; pending ones count as shown.
 */
export function useFilteredOut(posts: (FilterablePost & { handle?: string })[], place: FilterPlace): Set<string> {
  const env = useContext(EngineContext);
  const revision = useSyncExternalStore(env?.engine.subscribe ?? noop, env?.engine.getRevision ?? zero, zero);
  return useMemo(() => {
    const out = new Set<string>();
    if (!env) return out;
    for (const p of posts) {
      if (isOwnPost(p.handle, env.me)) continue;
      const v = env.engine.evaluate(p, place);
      if (v.state === 'filtered' && v.action !== 'blur') out.add(p.id);
    }
    return out;
  }, [env, posts, place, revision]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** What a feed should do with this post: show it, hide it, show it behind a notice, or blur its media. */
export function usePostFilter(post: FilterablePost & { handle?: string }): { verdict: Verdict; place: FilterPlace; product: string | null } {
  const env = useContext(EngineContext);
  const place = useContext(PlaceContext);
  const revision = useSyncExternalStore(env?.engine.subscribe ?? noop, env?.engine.getRevision ?? zero, zero);
  const subject = useMemo(() => (isOwnPost(post.handle, env?.me ?? null) ? { ...post, mine: true } : post), [post, env?.me]);
  const verdict = useMemo(() => (env ? env.engine.evaluate(subject, place) : CLEAR), [env, subject, place, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { env?.engine.request(subject, place); }, [env, subject, place, revision]);
  // Counted for Settings → Keyword filters ("Filtered 12 posts in the last 30 days"), once per post.
  useEffect(() => {
    if (verdict.state === 'filtered' && env?.account) recordFiltered(env.account, verdict.filter.id, subject.statusId ?? subject.id);
  }, [verdict, env?.account, subject.statusId, subject.id]);
  return { verdict, place, product: env?.product ?? null };
}

/**
 * Whether a post's author is someone the person doesn't follow on Fedizen, for "Blur media from people you don't
 * follow" (lib/reading-prefs). Asked only while `active`; false for their own posts and for posts with no Fedizen
 * account id (profiles, other servers' hashtag feeds), true while the answer is pending, so media doesn't flash
 * before it's veiled.
 */
export function useNotFollowed(post: { authorId?: string; handle?: string }, active: boolean): boolean {
  const env = useContext(EngineContext);
  useSyncExternalStore(env?.engine.subscribe ?? noop, env?.engine.getRevision ?? zero, zero);
  const id = active && env && !isOwnPost(post.handle, env.me) ? post.authorId : undefined;
  useEffect(() => { if (id) env?.following.request(id); }, [id, env]);
  if (!id || !env) return false;
  return env.following.get(id) !== true;
}

/** Which of these Fedizen account ids the person follows, as answers arrive (asked through the same batched
 *  relationship lookup as useNotFollowed). Empty outside a ContentFilterProvider. */
export function useFollowedAmong(ids: readonly string[]): ReadonlySet<string> {
  const env = useContext(EngineContext);
  const revision = useSyncExternalStore(env?.engine.subscribe ?? noop, env?.engine.getRevision ?? zero, zero);
  const list = ids.join(',');
  useEffect(() => { if (env) for (const id of ids) env.following.request(id); }, [env, list]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => new Set(env ? ids.filter(id => env.following.get(id) === true) : []), [env, list, revision]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * How many of these posts the person would actually see in Home under their filters (hidden ones and ones still
 * being checked by the AI model don't count). Starts the checks too, so new posts are judged before they're shown.
 */
/** The posts the person's filters would show (or show with a warning) in Home; hidden ones are left out. */
export function useShownPosts<T extends FilterablePost & { handle?: string }>(posts: T[]): T[] {
  const env = useContext(EngineContext);
  const revision = useSyncExternalStore(env?.engine.subscribe ?? noop, env?.engine.getRevision ?? zero, zero);
  const subjects = useMemo(() => posts.map(p => (isOwnPost(p.handle, env?.me ?? null) ? { ...p, mine: true } : p)), [posts, env?.me]);
  useEffect(() => { for (const p of subjects) env?.engine.request(p, 'home'); }, [env, subjects]);
  return useMemo(() => {
    if (!env) return posts;
    return posts.filter((_, i) => { const v = env.engine.evaluate(subjects[i], 'home'); return v.state === 'clear' || (v.state === 'filtered' && v.action !== 'hide'); });
  }, [env, posts, subjects, revision]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Spotlight is discovery, not a feed of messages already addressed to the
 * reader. Until the user's filter list is loaded and the existing engine
 * finishes relevant semantic checks, zero items may be displayed.
 */
export function useStrictSpotlightFilters(posts: FilterablePost[]): {
  cleared: ReadonlySet<string>; checking: boolean; unavailable: boolean;
} {
  const env = useContext(EngineContext);
  const q = useContentFilters(true);
  const revision = useSyncExternalStore(env?.engine.subscribe ?? noop, env?.engine.getRevision ?? zero, zero);
  const list = q.data && 'filters' in q.data ? q.data.filters : null;
  // A background revalidation keeps the last authoritative, owner-scoped rules.
  // Edits replace the query data, while errors still fail closed. Do not hide
  // every story every two minutes merely because a refresh is in flight.
  const ready = !!env && !!list && !q.isError &&
    env.engine.hasCurrentFilters(list);
  useEffect(() => {
    if (!ready) return;
    for (const p of posts) env?.engine.request(p, 'public');
  }, [env, posts, ready]);
  return useMemo(() => {
    const cleared = new Set<string>();
    let checking = !ready && !q.isError && posts.length > 0;
    let unavailable = q.isError && posts.length > 0;
    if (ready) for (const post of posts) {
      const state = env!.engine.discoveryState(post, 'public');
      if (state === 'clear') cleared.add(post.id);
      else if (state === 'pending') checking = true;
      else if (state === 'unavailable') unavailable = true;
    }
    return { cleared, checking, unavailable };
  }, [ready, q.isError, posts, env, revision]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useShownCount(posts: (FilterablePost & { handle?: string })[]): number {
  return useShownPosts(posts).length;
}

const CLEAR: Verdict = { state: 'clear' };
const noop = () => () => {};
const zero = () => 0;
