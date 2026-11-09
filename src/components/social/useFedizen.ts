import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useRef, useState } from 'react';
import { useAtlasAuth } from './AuthState';
import { disconnectFedizen, getFedizenHome, startFedizenConnect, type FedizenHome } from '@/lib/fedizen.functions';
import { getNativeBonfireSnapshot } from '@/lib/bonfire-private.functions';
import { shouldRequestNativeBonfireHome } from '@/lib/bonfire-native-presentation';
import { isEmbeddedPreview } from '@/lib/bonfire-auth';

/** Personal, server-authorized Fedizen feed; cached only under the Atlas user ID. */
export function useFedizen() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const home = useServerFn(getFedizenHome), start = useServerFn(startFedizenConnect), drop = useServerFn(disconnectFedizen);
  const nativeHome = useServerFn(getNativeBonfireSnapshot);
  const [actionError, setActionError] = useState<{ userId: string; message: string } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const pending = useRef(false);
  const id = user?.id;
  const key = ['fedizen-home', id] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: () => {
      if (!id) throw new Error('Atlas user is not signed in.');
      return home({ data: { expectedAtlasUserId: id } });
    },
    enabled: !!id,
    staleTime: 60_000,
  });
  const nativeKey = ['bonfire-native-home', id] as const;
  const nativeQuery = useQuery({
    queryKey: nativeKey,
    queryFn: () => {
      if (!id) throw new Error('Atlas user is not signed in.');
      return nativeHome({ data: { expectedAtlasUserId: id } });
    },
    enabled: shouldRequestNativeBonfireHome(!!id, q.data),
    staleTime: 60_000,
    retry: false,
  });
  const embedded = typeof window !== 'undefined' && isEmbeddedPreview();

  return {
    signedIn: !!id,
    loading: !!id && q.isLoading,
    data: q.data,
    native: nativeQuery.data,
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
        await Promise.all([
          qc.cancelQueries({ queryKey: key, exact: true }),
          qc.cancelQueries({ queryKey: nativeKey, exact: true }),
        ]);
        qc.removeQueries({ queryKey: nativeKey, exact: true });
        const disconnected: FedizenHome = {
          connected: false, accountHandle: null, posts: [], notices: [],
        };
        qc.setQueryData(key, disconnected);
      } catch {
        setActionError({ userId: id, message: 'Could not disconnect Fedizen. Please try again.' });
      } finally {
        pending.current = false;
        setActionBusy(false);
      }
    },
  };
}
