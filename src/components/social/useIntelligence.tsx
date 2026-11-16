import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
  addContentFilters, deleteContentFilter, expandContentFilter, getIntelligence, judgeFilteredPosts, listContentFilters,
  removeAiKey, saveAiKey, suggestContentFilters, updateContentFilter, updateIntelligence,
  type AiProblem, type IntelligenceStatus,
} from '@/lib/intelligence.functions';
import { FilterEngine } from '@/lib/filter-engine';
import { lintFilters, type ContentFilter, type FilterAction, type FilterablePost, type Verdict } from '@/lib/content-filter';
import type { ProviderId } from '@/lib/intelligence/providers';
import { useAtlasAuth } from './AuthState';

export const AI_PROBLEM: Record<AiProblem, string> = {
  'not-configured': 'Intelligence isn’t set up on this Atlas server yet.',
  'not-ready': 'Turn on Intelligence and add a key first.',
  'bad-key': 'That key wasn’t accepted. Check it and try again.',
  'no-access': 'That key can’t use any chat models. Check its permissions with the provider.',
  'rate-limited': 'The provider is limiting requests on this key. Try again in a minute.',
  unavailable: 'The provider didn’t answer. Try again.',
  'bad-output': 'The model’s answer couldn’t be used. Try again, or choose another model.',
  'bad-model': 'That model isn’t available to this key. Choose another.',
  storage: 'Atlas couldn’t save that. Try again.',
};

const statusKey = (id?: string) => ['intelligence', id] as const;
const filtersKey = (id?: string) => ['content-filters', id] as const;

/** Intelligence settings: whether it's on, the saved keys (last four characters only) and the chosen model. */
export function useIntelligence() {
  const { user } = useAtlasAuth();
  const read = useServerFn(getIntelligence);
  return useQuery({ queryKey: statusKey(user?.id), queryFn: () => read(), enabled: !!user, staleTime: 5 * 60_000 });
}

/** True when filters and the assistant can use AI right now. */
export const intelligenceReady = (s?: IntelligenceStatus) => !!s?.available && s.enabled && !!s.provider && !!s.model;

export function useIntelligenceActions() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const save = useServerFn(saveAiKey), remove = useServerFn(removeAiKey), update = useServerFn(updateIntelligence);
  const [busy, setBusy] = useState(false);
  const id = user?.id ?? '';
  const put = (s: IntelligenceStatus) => { qc.setQueryData(statusKey(user?.id), s); void qc.invalidateQueries({ queryKey: filtersKey(user?.id) }); };
  const run = async <T,>(fn: () => Promise<T>) => { setBusy(true); try { return await fn(); } finally { setBusy(false); } };
  return {
    busy,
    /** Null when saved, else what went wrong. The key itself isn't kept anywhere in the page afterwards. */
    saveKey: (provider: ProviderId, key: string, account?: string) => run(async (): Promise<string | null> => {
      try {
        const r = await save({ data: { expectedAtlasUserId: id, provider, key, ...(account ? { account } : {}) } });
        if ('error' in r) return AI_PROBLEM[r.error];
        put(r.status); return null;
      } catch { return AI_PROBLEM['bad-key']; }
    }),
    removeKey: (provider: ProviderId) => run(async () => { put(await remove({ data: { expectedAtlasUserId: id, provider } })); }),
    update: (patch: { enabled?: boolean; provider?: ProviderId; model?: string; deepMatching?: boolean }) => run(async () => { put(await update({ data: { expectedAtlasUserId: id, ...patch } })); }),
  };
}

/** The person's keyword filters (Atlas keeps them; Fedizen's list has no API to read yet). */
export function useContentFilters() {
  const { user } = useAtlasAuth();
  const read = useServerFn(listContentFilters);
  return useQuery({ queryKey: filtersKey(user?.id), queryFn: () => read(), enabled: !!user, staleTime: 5 * 60_000 });
}

export function useFilterActions() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const add = useServerFn(addContentFilters), change = useServerFn(updateContentFilter), del = useServerFn(deleteContentFilter);
  const expand = useServerFn(expandContentFilter), suggest = useServerFn(suggestContentFilters);
  const id = user?.id ?? '';
  const put = (filters: ContentFilter[]) => qc.setQueryData(filtersKey(user?.id), { filters });
  const status = qc.getQueryData<IntelligenceStatus>(statusKey(user?.id));
  /** New filters checked in context get their other wordings from the AI model, one at a time, in the background. */
  const widen = async (filters: ContentFilter[], ids: Set<string>) => {
    if (!intelligenceReady(status)) return;
    for (const f of filters) {
      if (!ids.has(f.id) || !f.semantic || f.expansions.length) continue;
      const r = await expand({ data: { expectedAtlasUserId: id, id: f.id } }).catch(() => null);
      if (r && 'filters' in r) put(r.filters); else break;
    }
  };
  return {
    add: async (texts: string[], action: FilterAction): Promise<string | null> => {
      try {
        const before = new Set((qc.getQueryData<{ filters?: ContentFilter[] }>(filtersKey(user?.id))?.filters ?? []).map(f => f.id));
        const r = await add({ data: { expectedAtlasUserId: id, texts, action } });
        if ('error' in r) return AI_PROBLEM[r.error];
        put(r.filters);
        void widen(r.filters, new Set(r.filters.filter(f => !before.has(f.id)).map(f => f.id)));
        return null;
      } catch { return AI_PROBLEM.storage; }
    },
    update: async (filterId: string, patch: { action?: FilterAction; semantic?: boolean }) => {
      const r = await change({ data: { expectedAtlasUserId: id, id: filterId, ...patch } });
      put(r.filters);
      if (patch.semantic) void widen(r.filters, new Set([filterId]));
    },
    remove: async (filterId: string) => { put((await del({ data: { expectedAtlasUserId: id, id: filterId } })).filters); },
    /** Re-asks for a filter's other wordings. */
    widen: async (filterId: string): Promise<string | null> => {
      const r = await expand({ data: { expectedAtlasUserId: id, id: filterId } }).catch(() => ({ error: 'unavailable' as const }));
      if ('error' in r) return AI_PROBLEM[r.error];
      put(r.filters); return null;
    },
    suggest: async () => {
      const r = await suggest({ data: { expectedAtlasUserId: id } }).catch(() => ({ error: 'unavailable' as const }));
      return r;
    },
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

const EngineContext = createContext<FilterEngine | null>(null);

/** Runs the person's filters over every post card under it. Mounted once at the root. */
export function ContentFilterProvider({ children }: { children: ReactNode }) {
  const { user } = useAtlasAuth();
  const [engine] = useState(() => new FilterEngine());
  const filters = useContentFilters();
  const intelligence = useIntelligence();
  const judge = useServerFn(judgeFilteredPosts);
  const list = useMemo(() => (user && filters.data && 'filters' in filters.data ? filters.data.filters : []), [user, filters.data]);
  const ready = intelligenceReady(intelligence.data);
  useEffect(() => {
    engine.configure({
      filters: list, ai: ready, deep: !!intelligence.data?.deepMatching, scope: user?.id,
      judge: async posts => { const r = await judge({ data: { posts } }); return 'error' in r ? null : r.verdicts; },
    });
  }, [engine, list, ready, intelligence.data?.deepMatching, user?.id, judge]);
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

/** What a feed should do with this post: show it, hide it, or show it behind a "Filtered" notice. */
export function usePostFilter(post: FilterablePost): Verdict {
  const engine = useContext(EngineContext);
  const revision = useSyncExternalStore(engine?.subscribe ?? noop, engine?.getRevision ?? zero, zero);
  const verdict = useMemo(() => (engine ? engine.evaluate(post) : CLEAR), [engine, post, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { engine?.request(post); }, [engine, post, revision]);
  return verdict;
}

const CLEAR: Verdict = { state: 'clear' };
const noop = () => () => {};
const zero = () => 0;
