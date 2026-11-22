import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useCallback, useState } from 'react';
import { getMyFedizenProfile, saveMyFedizenProfile } from '@/lib/fedizen-profile.functions';
import type { FedizenProfile } from '@/lib/fedizen-profile';
import { useAtlasAuth } from './AuthState';

/** What each problem means to the person, and what fixes it. */
export const PROFILE_PROBLEM: Record<string, string> = {
  disconnected: 'Connect Fedizen to edit your Fedizen profile.',
  'authorization-required': 'Fedizen ended Atlas’s access. Connect again to edit your profile.',
  'identity-unverified': 'This Fedizen connection isn’t the account linked to Atlas. Connect again.',
  'needs-permission': 'Connect Fedizen again to let Atlas edit your profile.',
  'rate-limited': 'Fedizen asked Atlas to slow down. Try again in a minute.',
  rejected: 'Fedizen didn’t accept that. Check the name and website and try again.',
  unavailable: 'Couldn’t reach Fedizen. Try again.',
};

/**
 * Your Fedizen profile (name, bio, website, location) from Bonfire's GraphQL, and saving it with `updateUser`.
 * Read only while Fedizen is connected; kept per Atlas account; `onSaved` lets the caller refresh what shows the
 * name elsewhere (the verified identity).
 */
export function useMyFedizenProfile(connected: boolean, onSaved?: () => void) {
  const { user } = useAtlasAuth();
  const id = user?.id;
  const qc = useQueryClient();
  const readFn = useServerFn(getMyFedizenProfile), saveFn = useServerFn(saveMyFedizenProfile);
  const key = ['fedizen-my-profile', id] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => readFn({ data: { expectedAtlasUserId: id! } }),
    enabled: !!id && connected,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [saving, setSaving] = useState(false);
  const save = useCallback(async (profile: FedizenProfile): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (!id) return { ok: false, message: PROFILE_PROBLEM.disconnected };
    setSaving(true);
    try {
      const r = await saveFn({ data: { expectedAtlasUserId: id, profile } });
      if (!r.ok) return { ok: false, message: PROFILE_PROBLEM[r.error] ?? PROFILE_PROBLEM.unavailable };
      qc.setQueryData(['fedizen-my-profile', id], { profile: r.profile, canWrite: true });
      onSaved?.();
      return { ok: true };
    } catch {
      return { ok: false, message: PROFILE_PROBLEM.unavailable };
    } finally {
      setSaving(false);
    }
  }, [id, saveFn, qc, onSaved]);
  return {
    profile: query.data?.profile ?? null,
    canWrite: query.data?.canWrite ?? false,
    loading: query.isLoading,
    problem: query.data?.error ? PROFILE_PROBLEM[query.data.error] ?? PROFILE_PROBLEM.unavailable : query.isError ? PROFILE_PROBLEM.unavailable : null,
    saving,
    save,
  };
}
