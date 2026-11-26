import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getFedizenViewer, getRelayFollows } from '@/lib/fedizen.functions';
import { avatarPreset, defaultAvatarKey } from '@/lib/atlas-avatars';
import { signedInThroughFedizen } from '@/lib/fedizen-viewer';
import { useAtlasAuth } from './AuthState';

/**
 * The connected Bonfire account is the social-profile authority. Atlas's
 * local profile remains separate for local-only settings and non-Fedizen users.
 * Query keys include the Supabase subject and are cleared on account switch.
 */
export function useFedizenIdentity() {
  const { user, profile } = useAtlasAuth();
  const viewerFn = useServerFn(getFedizenViewer);
  const query = useQuery({
    queryKey: ['fedizen-viewer', user?.id],
    queryFn: () => viewerFn(),
    enabled: !!user,
    staleTime: 90_000,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const viewer = query.data?.viewer ?? null;
  // FediBuzz relays the account follows (hashtags' relays, followed behind the scenes): plumbing, not people, so the
  // following count Atlas shows leaves them out (src/lib/fedibuzz-follows.server.ts).
  const relaysFn = useServerFn(getRelayFollows);
  const relays = useQuery({
    queryKey: ['fedizen-relay-follows', user?.id],
    queryFn: () => relaysFn({ data: { expectedAtlasUserId: user!.id } }),
    enabled: !!user && !!viewer, staleTime: 10 * 60_000, retry: false,
  });
  const relayCount = relays.data?.count ?? 0;
  const isFedizen = signedInThroughFedizen(user) || !!viewer || query.data?.connected === true;
  const avatar = viewer?.avatar ?? (!isFedizen && user
    ? avatarPreset(profile?.avatar_key ?? defaultAvatarKey(user.id)).src : null);
  return {
    viewer,
    isFedizen,
    connected: query.data?.connected === true,
    avatar,
    name: viewer?.name || profile?.display_name || user?.email || 'Your profile',
    handle: viewer?.handle || (isFedizen ? 'Fedizen profile not verified' : user?.email || ''),
    counts: viewer ? {
      followers: viewer.followers,
      following: viewer.following === null ? null : Math.max(0, viewer.following - relayCount),
      posts: viewer.posts,
    } : null,
    refresh: () => query.refetch(),
  };
}
