import { assertFedizenSessionIntent } from './fedizen-feed';
import { tokenFor } from './fedizen.server';
import {
  matchesLinkedFedizenHandle,
  readNativeBonfireMe,
} from './bonfire-private.server';

/**
 * Server-only request authorization. The caller-supplied Atlas user ID is
 * a stale-session/race guard, NEVER the authority to choose another user's
 * stored connection. Only the independently verified Supabase subject can
 * select the per-account token.
 *
 * Optional dependencies are for controlled offline security tests, not
 * browser inputs. No token or secret may be returned from a server function.
 */
type Dependencies = {
  tokenFor: typeof tokenFor;
  readMe: typeof readNativeBonfireMe;
};

const live: Dependencies = { tokenFor, readMe: readNativeBonfireMe };

export async function verifiedNativeBonfireConnection(
  expectedAtlasUserId: string,
  authenticatedAtlasUserId: string,
  dependencies: Dependencies = live,
) {
  // This must precede ALL external reads, including DB lookup.
  assertFedizenSessionIntent(expectedAtlasUserId, authenticatedAtlasUserId);

  const connection = await dependencies.tokenFor(authenticatedAtlasUserId);
  if (!connection) return { status: 'disconnected' as const };

  const identity = await dependencies.readMe(connection.access_token);
  if (!identity?.user) return { status: 'authorization-required' as const };
  if (!matchesLinkedFedizenHandle(connection.account_handle, identity.user.character?.username)) {
    return { status: 'identity-unverified' as const };
  }
  return {
    status: 'available' as const,
    accessToken: connection.access_token,
    accountHandle: connection.account_handle,
    identity,
  };
}
