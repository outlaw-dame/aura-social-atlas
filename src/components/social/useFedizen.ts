import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState } from 'react';
import { clearHomeCache, readHomeCache, writeHomeCache } from '@/lib/home-timeline';
import { useAtlasAuth } from './AuthState';
import { disconnectFedizen, getFedizenHome, getFedizenMessages, getFedizenStatus, startFedizenConnect, type FedizenHome } from '@/lib/fedizen.functions';
import { getNativeBonfireSnapshot, getNativeBonfireHomeContinuation, getNativeHomeDetails } from '@/lib/bonfire-private.functions';
import { mergeNativeBonfirePages, nativeCardsToRead, nextNativeHomeCursor, reconcileCachedHome, withNativeDetails, reconcileNativeContinuationStatus, shouldRequestNativeBonfireHome } from '@/lib/bonfire-native-presentation';
import { isEmbeddedPreview } from '@/lib/bonfire-auth';

/** Personal, server-authorized Fedizen feed; cached only under the Atlas user ID. */
export function useFedizen() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const statusFn = useServerFn(getFedizenStatus);
  const home = useServerFn(getFedizenHome), start = useServerFn(startFedizenConnect), drop = useServerFn(disconnectFedizen);
  const nativeHome = useServerFn(getNativeBonfireSnapshot);
  const nativeContinuation = useServerFn(getNativeBonfireHomeContinuation);
  const nativeDetails = useServerFn(getNativeHomeDetails);
  const [actionError, setActionError] = useState<{ userId: string; message: string } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const pending = useRef(false);
  const id = user?.id;
  const key = ['fedizen-home', id] as const;
  // Home opens on what was last seen on this device (lib/home-timeline), then the reader's background check
  // (useHomeTimeline) finds what's new, so the feed is never swapped out from under someone mid-read.
  const cached = typeof window !== 'undefined' && id ? readHomeCache<FedizenHome>(id) : null;
  const q = useQuery({
    queryKey: key,
    queryFn: () => {
      if (!id) throw new Error('Atlas user is not signed in.');
      return home({ data: { expectedAtlasUserId: id } });
    },
    enabled: !!id,
    ...(cached?.data.connected ? { initialData: cached.data, initialDataUpdatedAt: cached.savedAt } : {}),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  // Keep it for next time: only a connected, error-free Home, and only under this Atlas account.
  useEffect(() => {
    if (!id || !q.data) return;
    if (!q.data.connected) { clearHomeCache(id); return; }
    if (q.data.error) return;
    const t = setTimeout(() => writeHomeCache(id, q.data), 800);
    return () => clearTimeout(t);
  }, [id, q.data]);
  // A Home opened from this device's copy isn't read again, so ask the server once whether native reads are on and
  // the connection still stands: a changed switch updates only that field; a lost or different connection re-reads.
  const fromCache = !!cached?.data.connected;
  const status = useQuery({
    queryKey: ['fedizen-home-status', id] as const,
    queryFn: () => statusFn(),
    enabled: !!id && fromCache,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (!id || !status.data) return;
    const { refetch, patch } = reconcileCachedHome(qc.getQueryData<FedizenHome>(key), status.data);
    if (refetch) void qc.refetchQueries({ queryKey: key, exact: true });
    else if (patch) qc.setQueryData<FedizenHome | undefined>(key, prev => (prev ? { ...prev, ...patch } : prev));
    // key is derived from id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, status.data, qc]);
  const nativeKey = ['bonfire-native-home', id] as const;
  const nativeQuery = useInfiniteQuery({
    queryKey: nativeKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      if (!id) throw new Error('Atlas user is not signed in.');
      if (pageParam === null) {
        return nativeHome({ data: { expectedAtlasUserId: id } });
      }
      const page = await nativeContinuation({
        data: { expectedAtlasUserId: id, after: pageParam },
      });
      // A definitive server-side denial/revocation supersedes a cached
      // nativeReadEnabled flag. Fail closed immediately, even when the REST
      // status was fetched shortly before the operator disabled native reads.
      // A merely unavailable page keeps earlier valid posts untouched.
      if (page.status !== 'available') {
        if (page.status !== 'unavailable') {
          qc.setQueryData<FedizenHome | undefined>(key, previous =>
            reconcileNativeContinuationStatus(previous, page.status));
        }
        throw new Error('Native Home continuation unavailable');
      }
      return page;
    },
    getNextPageParam: (_last, pages, _lastParam, pageParams) =>
      nextNativeHomeCursor(pages, pageParams),
    enabled: shouldRequestNativeBonfireHome(!!id, q.data),
    staleTime: 60_000,
    retry: false,
  });
  // Cards that weren't read in time on the first load (GraphQL-only, Share only): their details are read right after,
  // with a longer allowance, and replace them in place.
  const merged = mergeNativeBonfirePages(q.data ?? { connected: false, accountHandle: null, posts: [], notices: [] }, nativeQuery.data?.pages);
  // Details already read stay applied while the next set is fetched, and aren't asked for again.
  const [readDetails, setReadDetails] = useState<Record<string, import('@/lib/fedizen-feed').FedizenPost>>({});
  const toRead = nativeCardsToRead(merged).filter(ref => !readDetails[ref]);
  const details = useQuery({
    queryKey: ['bonfire-native-details', id, toRead.join(',')] as const,
    queryFn: async () => {
      if (!id) throw new Error('Atlas user is not signed in.');
      const r = await nativeDetails({ data: { expectedAtlasUserId: id, statusIds: toRead } });
      return r.status === 'available' ? r.posts : {};
    },
    enabled: !!id && toRead.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (details.data && Object.keys(details.data).length) setReadDetails(d => ({ ...d, ...details.data }));
  }, [details.data]);
  useEffect(() => { setReadDetails({}); }, [id]);
  const embedded = typeof window !== 'undefined' && isEmbeddedPreview();

  return {
    signedIn: !!id,
    loading: !!id && q.isLoading,
    data: q.data,
    /** When the first page was fetched (or saved on this device, when Home opened on that). */
    updatedAt: q.dataUpdatedAt,
    native: withNativeDetails(merged, readDetails),
    /** Reads native Home again from its first page (after new posts were found). */
    refreshNative: () => (shouldRequestNativeBonfireHome(!!id, q.data) ? nativeQuery.refetch().then(() => undefined) : Promise.resolve()),
    loadingMoreNative: nativeQuery.isFetchingNextPage,
    hasMoreNative: nativeQuery.hasNextPage,
    moreNativeError: nativeQuery.isFetchNextPageError,
    loadMoreNative: () => {
      if (id && shouldRequestNativeBonfireHome(true, q.data) && nativeQuery.hasNextPage && !nativeQuery.isFetching) {
        void nativeQuery.fetchNextPage();
      }
    },
    nativeQueryError: nativeQuery.isError,
    // Only expose a message to the account which initiated the operation.
    error: actionError && actionError.userId === id ? actionError.message : null,
    actionBusy,
    embedded,
    queryError: q.isError,
    retry: () => { void q.refetch(); if (shouldRequestNativeBonfireHome(!!id, q.data)) void nativeQuery.refetch(); },
    connect: async () => {
      if (!id || pending.current) return;
      pending.current = true;
      setActionBusy(true);
      setActionError(null);
      try {
        const result = await start({ data: { origin: window.location.origin, expectedAtlasUserId: id } });
        if (!result.url) {
          setActionError({ userId: id, message: result.error || 'Fedizen connection was not started.' });
          return;
        }
        // The redirect target is returned by our server, which checks the
        // exact callback and request Origin before registering OAuth state.
        window.location.assign(result.url);
      } catch {
        setActionError({ userId: id, message: 'Could not connect to Fedizen. Please try again.' });
      } finally {
        pending.current = false;
        setActionBusy(false);
      }
    },
    disconnect: async () => {
      if (!id || pending.current) return;
      pending.current = true;
      setActionBusy(true);
      setActionError(null);
      try {
        await drop({ data: { expectedAtlasUserId: id } });
        // Cancel old user-bound reads before dropping their private responses;
        // an in-flight GET must not repopulate the cache after disconnect.
        // For You and pinned circles hold the same account's private posts; their views fall back to "Connect
        // Fedizen" when they read again.
        const personal = [['fedizen-foryou', id], ['fedizen-circle-feed', id], ['fedizen-tag-feed', id], ['fedizen-followed-tags', id]] as const;
        await Promise.all([
          qc.cancelQueries({ queryKey: key, exact: true }),
          qc.cancelQueries({ queryKey: ['fedizen-viewer', id], exact: true }),
          qc.cancelQueries({ queryKey: nativeKey, exact: true }),
          ...personal.map(k => qc.cancelQueries({ queryKey: k })),
        ]);
        // A stale verified avatar/handle must not survive disconnect.
        qc.setQueryData(['fedizen-viewer', id], { connected: false, viewer: null });
        qc.removeQueries({ queryKey: nativeKey, exact: true });
        for (const k of personal) qc.removeQueries({ queryKey: k });
        const disconnected: FedizenHome = {
          connected: false, accountHandle: null, posts: [], notices: [],
        };
        qc.setQueryData(key, disconnected);
        clearHomeCache(id);
      } catch {
        setActionError({ userId: id, message: 'Could not disconnect Fedizen. Please try again.' });
      } finally {
        pending.current = false;
        setActionBusy(false);
      }
    },
  };
}

/** Direct conversations from the person's Fedizen account, for Messages. Loaded only when Messages is opened. */
export function useFedizenMessages(enabled = true) {
  const { user } = useAtlasAuth();
  const read = useServerFn(getFedizenMessages);
  const id = user?.id;
  const q = useQuery({
    queryKey: ['fedizen-messages', id],
    queryFn: () => { if (!id) throw new Error('Atlas user is not signed in.'); return read({ data: { expectedAtlasUserId: id } }); },
    enabled: !!id && enabled, staleTime: 30_000,
  });
  return { data: q.data, loading: !!user && enabled && q.isLoading, queryError: q.isError, retry: () => { void q.refetch(); } };
}
