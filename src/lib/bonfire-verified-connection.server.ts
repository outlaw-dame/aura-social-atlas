import { tokenFor } from './fedizen.server';
import {
  matchesLinkedFedizenHandle,
  readNativeBonfireMe,
} from './bonfire-private.server';

/**
 * Resolve the user's *existing* delegated read token and independently check
 * that GraphQL Me matches the REST-verified Fedizen connection. This module
 * must remain server-only. Never return the resulting token to the browser.
 */
export async function verifiedNativeBonfireConnection(atlasUserId: string) {
  const connection = await tokenFor(atlasUserId);
  if (!connection) return { status: 'disconnected' as const };

  const identity = await readNativeBonfireMe(connection.access_token);
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
