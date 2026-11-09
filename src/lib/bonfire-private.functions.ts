import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { assertFedizenSessionIntent } from './fedizen-feed';
import type { NativeBonfireIdentity, NativeBonfireNotice } from './bonfire-private.server';
import type { fromBonfirePosts } from './spotlight';
type NativeBonfirePost = ReturnType<typeof fromBonfirePosts>[number];

export function nativeBonfireReadEnabled(value: string | undefined): boolean {
  return value === 'verified';
}

export type NativeBonfireSnapshot = {
  status: 'disabled' | 'disconnected' | 'authorization-required' | 'identity-unverified' | 'unavailable' | 'available';
  identity: NativeBonfireIdentity;
  /** Native IDs and account fields are not assumed to equal REST or OIDC IDs. */
  restAccountHandle: string | null;
  posts: NativeBonfirePost[];
  notices: NativeBonfireNotice[];
  homeEndCursor: string | null;
  homeHasNextPage: boolean;
  notificationEndCursor: string | null;
  notificationHasNextPage: boolean;
};

/**
 * Operator gated until a real, consented OAuth test proves that Fedizen's
 * delegated API bearer is accepted by GraphQL and resolves the correct user.
 * This must not silently replace the currently working REST Home experience.
 */
export const getNativeBonfireSnapshot = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({
    expectedAtlasUserId: z.string().uuid(),
    homeAfter: z.string().max(2048).nullable().optional(),
    notificationsAfter: z.string().max(2048).nullable().optional(),
  }).parse(input))
  .handler(async ({ data, context }): Promise<NativeBonfireSnapshot> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const base = {
      identity: null,
      restAccountHandle: null,
      posts: [],
      notices: [],
      homeEndCursor: null,
      homeHasNextPage: false,
      notificationEndCursor: null,
      notificationHasNextPage: false,
    } satisfies Omit<NativeBonfireSnapshot, 'status'>;

    if (!nativeBonfireReadEnabled(process.env['ATLAS_BONFIRE_NATIVE_GRAPHQL_READS'])) {
      return { ...base, status: 'disabled' };
    }

    try {
      const [{ verifiedNativeBonfireConnection }, native] = await Promise.all([
        import('./bonfire-verified-connection.server'),
        import('./bonfire-private.server'),
      ]);
      const connection = await verifiedNativeBonfireConnection(data.expectedAtlasUserId, context.userId);
      if (connection.status !== 'available') return { ...base, status: connection.status };
      const [home, notifications] = await Promise.all([
        native.readNativeBonfirePage(connection.accessToken, 'myFeed', data.homeAfter ?? null),
        native.readNativeBonfirePage(connection.accessToken, 'notifications', data.notificationsAfter ?? null),
      ]);
      if (!home || !notifications) return { ...base, status: 'authorization-required' };
      const normalizedHome = native.normalizeNativeBonfireHome(home);
      const normalizedNotifications = native.normalizeNativeBonfireNotifications(notifications);
      return {
        status: 'available',
        identity: connection.identity,
        restAccountHandle: connection.accountHandle,
        posts: normalizedHome.posts,
        notices: normalizedNotifications.notices,
        homeEndCursor: normalizedHome.pageInfo.endCursor ?? null,
        homeHasNextPage: normalizedHome.pageInfo.hasNextPage,
        notificationEndCursor: normalizedNotifications.pageInfo.endCursor ?? null,
        notificationHasNextPage: normalizedNotifications.pageInfo.hasNextPage,
      };
    } catch {
      // No raw GraphQL, token, or private account data in errors/logs.
      return { ...base, status: 'unavailable' };
    }
  });

/**
 * Cursor continuation fetches only Home, never re-fetching notifications.
 * Authentication, linked-account verification and the release gate are
 * independently enforced on *every* page—not inherited from browser state.
 */
export const getNativeBonfireHomeContinuation = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({
    expectedAtlasUserId: z.string().uuid(),
    after: z.string().min(1).max(2048).regex(/^[^\u0000-\u001f\u007f]+$/),
  }).parse(input))
  .handler(async ({ data, context }): Promise<NativeBonfireSnapshot> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const base = {
      identity: null,
      restAccountHandle: null,
      posts: [],
      notices: [],
      homeEndCursor: null,
      homeHasNextPage: false,
      notificationEndCursor: null,
      notificationHasNextPage: false,
    } satisfies Omit<NativeBonfireSnapshot, 'status'>;
    if (!nativeBonfireReadEnabled(process.env['ATLAS_BONFIRE_NATIVE_GRAPHQL_READS'])) {
      return { ...base, status: 'disabled' };
    }
    try {
      const [{ verifiedNativeBonfireConnection }, native] = await Promise.all([
        import('./bonfire-verified-connection.server'),
        import('./bonfire-private.server'),
      ]);
      const connection = await verifiedNativeBonfireConnection(data.expectedAtlasUserId, context.userId);
      if (connection.status !== 'available') return { ...base, status: connection.status };

      const home = await native.readNativeBonfirePage(connection.accessToken, 'myFeed', data.after);
      if (!home) return { ...base, status: 'authorization-required' };
      // Repeating the incoming cursor with a claimed next page would leave
      // a client in a non-advancing pagination loop. Reject such a response.
      if (home.pageInfo.hasNextPage &&
        (!home.pageInfo.endCursor || home.pageInfo.endCursor === data.after)) {
        return { ...base, status: 'unavailable' };
      }
      const result = native.normalizeNativeBonfireHome(home);
      return {
        ...base,
        status: 'available',
        identity: connection.identity,
        restAccountHandle: connection.accountHandle,
        posts: result.posts,
        homeEndCursor: result.pageInfo.endCursor ?? null,
        homeHasNextPage: result.pageInfo.hasNextPage,
      };
    } catch {
      return { ...base, status: 'unavailable' };
    }
  });
