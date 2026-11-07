import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { useAtlasAuth } from './AuthState';
import { disconnectFedizen, getFedizenHome, startFedizenConnect } from '@/lib/fedizen.functions';
import { isEmbeddedPreview } from '@/lib/bonfire-auth';

/** Personal Fedizen feed + notifications for the signed-in Atlas account. */
export function useFedizen() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const home = useServerFn(getFedizenHome), start = useServerFn(startFedizenConnect), drop = useServerFn(disconnectFedizen);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['fedizen-home', user?.id], queryFn: () => home(), enabled: !!user, staleTime: 60_000 });
  const embedded = typeof window !== 'undefined' && isEmbeddedPreview();
  return {
    signedIn: !!user, loading: !!user && q.isLoading, data: q.data, error, embedded, queryError: q.isError, retry: () => { void q.refetch(); },
    connect: async () => {
      setError(null);
      const r = await start({ data: { origin: window.location.origin } });
      if (r.url) window.location.assign(r.url); else setError(r.error);
    },
    disconnect: async () => { await drop(); await qc.invalidateQueries({ queryKey: ['fedizen-home'] }); },
  };
}
