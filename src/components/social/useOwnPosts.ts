import { useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useAtlasAuth } from './AuthState';
import { LIBRARY_PROBLEM } from './useFedizenLibrary';
import { useIsMe } from './useFediProfile';
import {
  answerFollowRequest, deleteFedizenPost, editFedizenPost, getFedizenPostSource, getFollowRequests, getLikedPosts, getMutedAccounts, getWhoReacted,
  muteFedizenAccount, reportOnFedizen, searchFedizenPosts, suggestHashtags, voteOnFedizenPoll,
} from '@/lib/fedizen.functions';
import type { FediPoll, FedizenPost } from '@/lib/fedizen-feed';

/** Every feed that can show a post: after an edit or delete they all read Fedizen again. */
const FEEDS = ['fedizen-home', 'bonfire-native-home', 'fedizen-saved', 'fedizen-foryou', 'fedizen-tag-feed', 'fedizen-circle-feed', 'fedizen-search-posts'];
const refreshFeeds = (qc: ReturnType<typeof useQueryClient>) => { for (const k of FEEDS) void qc.invalidateQueries({ queryKey: [k] }); };

const problem = (e: string) => (e === 'not-found' ? 'That post is gone or isn’t yours to change.' : LIBRARY_PROBLEM[e as keyof typeof LIBRARY_PROBLEM] ?? LIBRARY_PROBLEM.unavailable);

/* Posts deleted in this session disappear from every feed at once, before the feeds read Fedizen again. */
const deleted = (() => {
  let ids = new Set<string>();
  const listeners = new Set<() => void>();
  return {
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    snapshot: () => ids,
    add: (id: string) => { ids = new Set(ids).add(id); listeners.forEach(l => l()); },
  };
})();
/** Whether this post was deleted here (feed cards render nothing for it). */
export function useIsDeleted(statusId?: string) {
  const ids = useSyncExternalStore(deleted.subscribe, deleted.snapshot, deleted.snapshot);
  return !!statusId && ids.has(statusId);
}

/** Whether the reader wrote this post (their own posts offer Edit and Delete). Boosts of it are still theirs to edit. */
export function useIsMine(post: Pick<FedizenPost, 'acct'>) {
  return useIsMe(post.acct);
}

export function useDeletePost() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const del = useServerFn(deleteFedizenPost);
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (statusId: string) => del({ data: { expectedAtlasUserId: user!.id, statusId } }),
    onSuccess: (r, statusId) => { if (r.ok) { deleted.add(statusId); refreshFeeds(qc); setError(null); } else setError(problem(r.error)); },
    onError: () => setError(problem('unavailable')),
  });
  return { remove: async (statusId: string) => { if (!user) return false; const r = await m.mutateAsync(statusId).catch(() => null); return !!r?.ok; }, busy: m.isPending, error };
}

/** Editing a post as Mastodon does: start from its source (text and content warning), save both, mark it edited. */
export function useEditPost(statusId: string | null) {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const read = useServerFn(getFedizenPostSource), write = useServerFn(editFedizenPost);
  const source = useQuery({
    queryKey: ['fedizen-post-source', user?.id, statusId],
    queryFn: () => read({ data: { expectedAtlasUserId: user!.id, statusId: statusId! } }),
    enabled: !!user && !!statusId, staleTime: 0, gcTime: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (v: { text: string; cw: string }) => write({ data: { expectedAtlasUserId: user!.id, statusId: statusId!, text: v.text, cw: v.cw } }),
    onSuccess: r => { if (r.ok) { refreshFeeds(qc); setError(null); } else setError(problem(r.error)); },
    onError: () => setError(problem('unavailable')),
  });
  const loaded = source.data?.ok ? source.data : null;
  return {
    loading: source.isLoading, text: loaded?.text, cw: loaded?.cw,
    loadError: source.data && !source.data.ok ? problem(source.data.error) : source.isError ? problem('unavailable') : null,
    save: async (text: string, cw: string) => { const r = await m.mutateAsync({ text, cw }).catch(() => null); return !!r?.ok; },
    saving: m.isPending, error,
  };
}

/* Polls: votes cast here show at once in every feed, with Fedizen's counts once it answers. */
const polls = (() => {
  let map = new Map<string, FediPoll>();
  const listeners = new Set<() => void>();
  return {
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    snapshot: () => map,
    set: (p: FediPoll) => { map = new Map(map).set(p.id, p); listeners.forEach(l => l()); },
  };
})();

export function usePoll(initial: FediPoll) {
  const { user } = useAtlasAuth();
  const map = useSyncExternalStore(polls.subscribe, polls.snapshot, polls.snapshot);
  const poll = map.get(initial.id) ?? initial;
  const vote = useServerFn(voteOnFedizenPoll);
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (choices: number[]) => vote({ data: { expectedAtlasUserId: user!.id, pollId: poll.id, choices } }),
    onMutate: choices => {
      // Shown voted straight away; the counts settle on Fedizen's answer.
      const options = poll.options.map((o, i) => (choices.includes(i) && o.votes !== undefined ? { ...o, votes: o.votes + 1 } : o));
      polls.set({ ...poll, options, voted: true, ownVotes: choices, ...(poll.voters !== undefined ? { voters: poll.voters + 1 } : {}), ...(poll.votes !== undefined ? { votes: poll.votes + choices.length } : {}) });
    },
    onSuccess: r => {
      if (r.ok) { if (r.poll) polls.set(r.poll); setError(null); }
      else { polls.set(poll); setError(r.error === 'closed' ? 'This poll has closed.' : problem(r.error)); }
    },
    onError: () => { polls.set(poll); setError(problem('unavailable')); },
  });
  return { poll, vote: (choices: number[]) => { if (user && choices.length) m.mutate(choices); }, voting: m.isPending, error, signedIn: !!user };
}

export function useFollowRequests() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const read = useServerFn(getFollowRequests), answer = useServerFn(answerFollowRequest);
  const q = useQuery({
    queryKey: ['fedizen-follow-requests', user?.id],
    queryFn: () => read({ data: { expectedAtlasUserId: user!.id } }),
    enabled: !!user, staleTime: 30_000,
  });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (v: { accountId: string; accept: boolean }) => answer({ data: { expectedAtlasUserId: user!.id, ...v } }),
    onSuccess: (r, v) => {
      if (!r.ok) { setError(problem(r.error)); return; }
      setError(null);
      qc.setQueryData(['fedizen-follow-requests', user?.id], (old: { people: { id: string }[] } | undefined) => (old ? { ...old, people: old.people.filter(p => p.id !== v.accountId) } : old));
      void qc.invalidateQueries({ queryKey: ['fedizen-home'] });
    },
    onError: () => setError(problem('unavailable')),
  });
  return {
    people: q.data?.people ?? [], loading: q.isLoading, readError: q.data?.error && q.data.error !== 'not-connected' ? problem(q.data.error) : null,
    answer: (accountId: string, accept: boolean) => m.mutate({ accountId, accept }), busyId: m.isPending ? m.variables?.accountId : undefined, error,
  };
}

/** Posts on Fedizen matching a search, once it's two characters or more. */
export function useSearchPosts(q: string) {
  const { user } = useAtlasAuth();
  const search = useServerFn(searchFedizenPosts);
  const term = q.trim();
  const r = useQuery({
    queryKey: ['fedizen-search-posts', user?.id, term],
    queryFn: () => search({ data: { expectedAtlasUserId: user!.id, q: term } }),
    enabled: !!user && term.length >= 2, staleTime: 60_000,
  });
  return { posts: r.data?.posts ?? [], related: r.data?.related ?? [], loading: r.isFetching, error: r.data?.error && r.data.error !== 'not-connected' ? problem(r.data.error) : r.isError ? problem('unavailable') : null, available: !!user };
}

/** One handle written two ways: "@ann" and "ann@fedizen.net" are the same Fedizen person. */
export const sameAcct = (a: string, b: string) => { const n = (h: string) => h.replace(/^@/, '').toLowerCase().replace(/@fedizen\.net$/, ''); return n(a) === n(b); };

/** Who you mute, and muting or unmuting someone (by their Fedizen account id or handle). */
export function useMutes(enabled = true) {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const read = useServerFn(getMutedAccounts), write = useServerFn(muteFedizenAccount);
  const q = useQuery({ queryKey: ['fedizen-mutes', user?.id], queryFn: () => read({ data: { expectedAtlasUserId: user!.id } }), enabled: !!user && enabled, staleTime: 60_000 });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (v: { accountId?: string; acct?: string; on: boolean }) => write({ data: { expectedAtlasUserId: user!.id, ...v } }),
    onSuccess: r => { if (r.ok) { setError(null); void qc.invalidateQueries({ queryKey: ['fedizen-mutes'] }); refreshFeeds(qc); } else setError(problem(r.error === 'not-found' ? 'unavailable' : r.error)); },
    onError: () => setError(problem('unavailable')),
  });
  return {
    people: q.data?.people ?? [], loading: q.isLoading, readError: q.data?.error && q.data.error !== 'not-connected' ? problem(q.data.error) : null,
    mute: async (v: { accountId?: string; acct?: string; on: boolean }) => { if (!user) return false; const r = await m.mutateAsync(v).catch(() => null); return !!r?.ok; },
    busy: m.isPending, error, signedIn: !!user,
    /** Whether this account is in the muted list (by Fedizen id, else handle). */
    isMuted: (a: { accountId?: string; acct?: string }) => (q.data?.people ?? []).some(p => (a.accountId && p.id === a.accountId) || (!!a.acct && sameAcct(p.handle, a.acct))),
  };
}

export type ReportCategory = 'spam' | 'legal' | 'violation' | 'other';
/** Mastodon's report reasons, in its words. */
export const REPORT_CATEGORIES: { id: ReportCategory; label: string; note: string }[] = [
  { id: 'spam', label: 'It’s spam', note: 'Malicious links, fake engagement, or repetitive replies' },
  { id: 'violation', label: 'It breaks the server’s rules', note: 'Fedizen’s rules, as its moderators apply them' },
  { id: 'legal', label: 'It’s illegal', note: 'Something you believe breaks the law where you or the server are' },
  { id: 'other', label: 'Something else', note: 'Explain in your note' },
];

/** Reporting an account, and optionally one of its posts, to Fedizen's moderators. */
export function useReport() {
  const { user } = useAtlasAuth();
  const send = useServerFn(reportOnFedizen);
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (v: { accountId?: string; acct?: string; statusIds?: string[]; comment: string; category: ReportCategory; forward: boolean }) => send({ data: { expectedAtlasUserId: user!.id, ...v } }),
    onSuccess: r => setError(r.ok ? null : r.error === 'not-found' ? 'Fedizen couldn’t find that account.' : problem(r.error)),
    onError: () => setError(problem('unavailable')),
  });
  return { report: async (v: Parameters<typeof m.mutateAsync>[0]) => { if (!user) return false; const r = await m.mutateAsync(v).catch(() => null); return !!r?.ok; }, busy: m.isPending, error };
}

/** Who liked or boosted a post, read when asked for. */
export function useWhoReacted(statusId: string | null, kind: 'like' | 'boost') {
  const { user } = useAtlasAuth();
  const read = useServerFn(getWhoReacted);
  const q = useQuery({
    queryKey: ['fedizen-who-reacted', user?.id, statusId, kind],
    queryFn: () => read({ data: { expectedAtlasUserId: user!.id, statusId: statusId!, kind } }),
    enabled: !!user && !!statusId, staleTime: 30_000,
  });
  return { people: q.data?.people ?? [], loading: q.isLoading, error: q.data?.error ? problem(q.data.error) : q.isError ? problem('unavailable') : null };
}

/** Posts you liked, newest first. */
export function useLikedPosts(enabled = true) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getLikedPosts);
  const q = useQuery({ queryKey: ['fedizen-liked', user?.id], queryFn: () => read({ data: { expectedAtlasUserId: user!.id } }), enabled: !!user && enabled, staleTime: 60_000 });
  return { posts: q.data?.posts ?? [], loading: q.isLoading, error: q.data?.error ? problem(q.data.error) : q.isError ? problem('unavailable') : null, signedIn: !!user };
}

/** Hashtags starting with `q` (what's typed after "#"), for the composer. */
export function useHashtagSuggestions(q: string | null) {
  const { user } = useAtlasAuth();
  const read = useServerFn(suggestHashtags);
  const term = q && /^[\p{L}\p{N}_]{1,100}$/u.test(q) ? q : null;
  const r = useQuery({
    queryKey: ['fedizen-tag-suggest', user?.id, term?.toLowerCase()],
    queryFn: () => read({ data: { expectedAtlasUserId: user!.id, q: term! } }),
    enabled: !!user && !!term, staleTime: 5 * 60_000,
  });
  return r.data?.tags ?? [];
}
