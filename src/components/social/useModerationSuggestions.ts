import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtlasAuth } from './AuthState';
import { AI_PROBLEM, DEFAULT_OPTIONS, intelligenceReady, useContentFilters, useFilterActions, useIntelligence } from './useIntelligence';
import { useBlockActions, useFedizenBlocks } from './useFedizenLibrary';
import { useMutes } from './useOwnPosts';
import { MAX_CONTEXT_HANDLES, accountCandidates, acctKey, clearSignals } from '@/lib/moderation-signals';
import type { AccountSuggestion, FilterSuggestions } from '@/lib/intelligence/tasks';

/** The last answer, as kept on this device: what was suggested, the filters' words then, and what was dismissed. */
type Kept = {
  at: string;
  suggestions: FilterSuggestions['suggestions'];
  cautions: (FilterSuggestions['cautions'][number] & { asked: string })[];
  accounts: AccountSuggestion[];
  dismissed: string[];
};
const key = (uid: string) => `atlas.moderation-suggestions.${uid}`;
const read = (uid: string): Kept | null => {
  try { const v = JSON.parse(localStorage.getItem(key(uid)) ?? 'null') as Kept | null; return v && Array.isArray(v.suggestions) ? { ...v, accounts: v.accounts ?? [], dismissed: v.dismissed ?? [] } : null; } catch { return null; }
};
const write = (uid: string, v: Kept | null) => { try { if (v) localStorage.setItem(key(uid), JSON.stringify(v)); else localStorage.removeItem(key(uid)); } catch { /* kept this visit only */ } };

/** A suggestion's key, for dismissing it. */
export const itemKey = {
  filter: (text: string) => `filter:${text.toLowerCase()}`,
  caution: (filterId: string, issue: string) => `caution:${filterId}:${issue}`,
  account: (acct: string) => `account:${acct}`,
};

/**
 * Settings → Moderation → Suggestions (desktop section, phone pushed page): Intelligence's answer from the person's
 * filters, blocks, mutes and what their moderation noticed on this device (lib/moderation-signals) — filters to add,
 * notes on filters with words to change them to, and accounts to block or mute. Kept on this device until each is
 * acted on or dismissed. Nothing is blocked, muted or changed until the person taps it.
 */
export function useModerationSuggestions() {
  const { user } = useAtlasAuth();
  const ai = intelligenceReady(useIntelligence().data);
  const q = useContentFilters();
  const filters = useMemo(() => (q.data && 'filters' in q.data ? q.data.filters : []), [q.data]);
  const act = useFilterActions();
  const blocks = useFedizenBlocks(!!user);
  const blocker = useBlockActions();
  const mutes = useMutes(!!user);
  const [kept, setKept] = useState<Kept | null>(null);
  const [thinking, setThinking] = useState(false), [note, setNote] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { setKept(user ? read(user.id) : null); }, [user]);
  const save = useCallback((v: Kept | null) => { setKept(v); if (user) write(user.id, v); }, [user]);

  const blocked = useMemo(() => (blocks.data?.people ?? []).map(p => acctKey(p.handle)).filter((a): a is string => !!a), [blocks.data]);
  const muted = useMemo(() => mutes.people.map(p => acctKey(p.handle)).filter((a): a is string => !!a), [mutes.people]);

  const ask = async () => {
    if (!user) return;
    setThinking(true); setNote(null);
    const skip = new Set([...blocked, ...muted]);
    const r = await act.suggest({ blocked: blocked.slice(0, MAX_CONTEXT_HANDLES), muted: muted.slice(0, MAX_CONTEXT_HANDLES), noticed: accountCandidates(user.id, skip) });
    setThinking(false);
    if ('error' in r) { setNote(AI_PROBLEM[r.error]); return; }
    save({
      at: new Date().toISOString(), suggestions: r.suggestions, accounts: r.accounts ?? [], dismissed: [],
      cautions: r.cautions.map(c => ({ ...c, asked: filters.find(f => f.id === c.filterId)?.text ?? '' })),
    });
  };
  const dismiss = (k: string) => { if (kept) save({ ...kept, dismissed: [...kept.dismissed, k] }); };
  const run = async (k: string, work: () => Promise<string | null>) => {
    setBusy(k); setNote(null);
    try { const why = await work(); if (why) setNote(why); else dismiss(k); } finally { setBusy(null); }
  };

  // What still applies: not dismissed, filters not already there, notes whose filter still has the words it was about,
  // accounts not blocked or muted since.
  const have = new Set(filters.map(f => f.text.toLowerCase())), gone = new Set(kept?.dismissed ?? []), done = new Set([...blocked, ...muted]);
  const toAdd = (kept?.suggestions ?? []).filter(s => !gone.has(itemKey.filter(s.text)) && !have.has(s.text.toLowerCase()));
  const toChange = (kept?.cautions ?? []).filter(c => !gone.has(itemKey.caution(c.filterId, c.issue)) && filters.find(f => f.id === c.filterId)?.text === c.asked);
  const accounts = (kept?.accounts ?? []).filter(a => !gone.has(itemKey.account(a.acct)) && !done.has(a.acct));

  return {
    signedIn: !!user, ai, thinking, note, busy, askedAt: kept?.at ?? null, ask,
    toAdd, toChange, accounts, canBlock: !!blocks.data?.canWrite,
    hasFilters: filters.length > 0, hasContext: blocked.length + muted.length > 0,
    addFilter: (text: string) => run(itemKey.filter(text), () => act.add([text], DEFAULT_OPTIONS)),
    changeFilter: (filterId: string, issue: string, text: string) => run(itemKey.caution(filterId, issue), () => act.update(filterId, { text })),
    block: (acct: string) => run(itemKey.account(acct), () => blocker.block(acct)),
    mute: (acct: string) => run(itemKey.account(acct), async () => (await mutes.mute({ acct, on: true })) ? null : (mutes.error ?? AI_PROBLEM.unavailable)),
    dismiss,
    /** Forget the answer and what Atlas noted on this device for it. */
    forget: () => { if (user) clearSignals(user.id); save(null); },
  };
}
