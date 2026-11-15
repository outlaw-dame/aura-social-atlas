import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { assertFedizenSessionIntent } from './fedizen-feed';
import { nativeBonfireReadEnabled } from './bonfire-private.functions';
import { bonfireDetailIDSchema, profileSelectorSchema } from './bonfire-detail-contract';
import type { NativeBonfirePostDetail, NativeBonfireProfile } from './bonfire-detail.server';

const requestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('profile'),
    expectedAtlasUserId: z.string().uuid(),
    selector: profileSelectorSchema,
  }),
  z.object({
    kind: z.literal('post'),
    expectedAtlasUserId: z.string().uuid(),
    id: bonfireDetailIDSchema,
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
    try {
      const [{ verifiedNativeBonfireConnection }, detailReads] = await Promise.all([
        import('./bonfire-verified-connection.server'),
        import('./bonfire-detail.server'),
      ]);
      // Server-verified Supabase subject, not the caller's requested ID,
      // selects the account's credential; Me must agree with the stored owner.
      const connection = await verifiedNativeBonfireConnection(
        data.expectedAtlasUserId, context.userId,
      );
      if (connection.status !== 'available') {
        return { ...base, status: connection.status };
      }

      if (data.kind === 'profile') {
        const profile = await detailReads.readNativeBonfireProfile(
          connection.accessToken, data.selector,
        );
        return { ...base, status: 'available', profile };
      }

      const post = await detailReads.readNativeBonfirePost(
        connection.accessToken, data.id,
      );
      return { ...base, status: 'available', post };
    } catch {
      // Never expose private upstream errors, GraphQL selection sets, identities
      // or consented bearer credentials in API errors or logs.
      return { ...base, status: 'unavailable' };
    }
  });
