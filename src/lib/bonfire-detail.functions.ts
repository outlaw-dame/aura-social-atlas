import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { assertFedizenSessionIntent } from './fedizen-feed';
import { nativeBonfireReadEnabled } from './bonfire-private.functions';
import { profileSelectorSchema, type NativeBonfirePostDetail, type NativeBonfireProfile } from './bonfire-detail.server';

const requestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('profile'),
    expectedAtlasUserId: z.string().uuid(),
    selector: profileSelectorSchema,
  }),
  z.object({
    kind: z.literal('post'),
    expectedAtlasUserId: z.string().uuid(),
    id: z.string().min(1).max(320).regex(/^[^\u0000-\u001f\u007f]+$/),
  }),
]);

export type BonfireDetailSnapshot = {
  status: 'disabled' | 'disconnected' | 'authorization-required' |
    'identity-unverified' | 'unavailable' | 'available';
  profile: NativeBonfireProfile | null;
  post: NativeBonfirePostDetail | null;
};

/**
 * This remains disabled by default and is not bound to any public UI route.
 * The actual delegated API token is fetched only from the server's
 * user-scoped Fedizen connection; no caller can choose another user's token.
 * Bonfire's actual permission/boundary engine remains authoritative.
 */
export const getNativeBonfireDetail = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator(data => requestSchema.parse(data))
  .handler(async ({ data, context }): Promise<BonfireDetailSnapshot> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const base = { profile: null, post: null };
    if (!nativeBonfireReadEnabled(process.env['ATLAS_BONFIRE_NATIVE_GRAPHQL_READS'])) {
      return { ...base, status: 'disabled' };
    }
    const [{ tokenFor }, privateReads, detailReads] = await Promise.all([
      import('./fedizen.server'),
      import('./bonfire-private.server'),
      import('./bonfire-detail.server'),
    ]);
    const connection = await tokenFor(context.userId);
    if (!connection) return { ...base, status: 'disconnected' };

    try {
      // Always resolve the delegated bearer to a Bonfire identity first;
      // never expose a detail record through a mismatched Atlas connection.
      const me = await privateReads.readNativeBonfireMe(connection.access_token);
      if (!me?.user) return { ...base, status: 'authorization-required' };
      if (!privateReads.matchesLinkedFedizenHandle(
        connection.account_handle, me.user.character?.username,
      )) return { ...base, status: 'identity-unverified' };

      if (data.kind === 'profile') {
        const profile = await detailReads.readNativeBonfireProfile(
          connection.access_token, data.selector,
        );
        return { ...base, status: 'available', profile };
      }

      const post = await detailReads.readNativeBonfirePost(
        connection.access_token, data.id,
      );
      return { ...base, status: 'available', post };
    } catch {
      // Never expose private upstream errors, GraphQL selection sets, identities
      // or consented bearer credentials in API errors or logs.
      return { ...base, status: 'unavailable' };
    }
  });
