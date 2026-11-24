import { useState } from 'react';
import { MAX_OWN_FEATURED } from '@/lib/featured-tags';
import { useAtlasAuth } from './AuthState';

/**
 * Featuring a hashtag on your own profile from its page, as Mastodon 4.4 does (POST /api/v1/tags/:id/feature). Fedizen
 * can't keep them yet (Bonfire rc.1 answers its featured_tags writes with "not yet implemented"), so they live on your
 * Atlas profile (featured_hashtags), shown on your Profile's Featured tab.
 */
export function useFeatureTag(tag: string | null) {
  const { user, profile, updateProfile } = useAtlasAuth();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const list = profile?.featured_hashtags ?? [];
  const t = tag?.replace(/^#/, '').toLowerCase() ?? '';
  const featured = !!t && list.some(x => x.toLowerCase() === t);
  const full = !featured && list.length >= MAX_OWN_FEATURED;
  const toggle = async () => {
    if (!user || !t || busy) return;
    if (full) { setError(`You can feature up to ${MAX_OWN_FEATURED} hashtags. Remove one from Edit profile first.`); return; }
    setBusy(true); setError(null);
    try { await updateProfile({ featured_hashtags: featured ? list.filter(x => x.toLowerCase() !== t) : [...list, t] }); }
    catch { setError('Your profile couldn’t be updated. Try again.'); }
    finally { setBusy(false); }
  };
  return { available: !!user && !!t, featured, busy, error, toggle };
}
