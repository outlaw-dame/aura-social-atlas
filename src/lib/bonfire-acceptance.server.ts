/**
 * Read-only, opt-in Fedizen acceptance against the *existing* Atlas OAuth
 * connection. No secrets, handles, IDs, cursors or remote error strings leave
 * this module. This does not promote the normal native read feature flag.
 */
import { verifyFedizenReadGrant, tokenFor } from './fedizen.server';
import { readNativeBonfireMe, readNativeBonfirePage, matchesLinkedFedizenHandle, isConclusiveAnonymousMeDenial } from './bonfire-private.server';
import { readNativeBonfireProfile } from './bonfire-detail.server';

export type AcceptanceCheck =
  | 'delegated-rest-owner' | 'graphql-me-owner' | 'graphql-own-profile'
  | 'graphql-my-feed' | 'graphql-notifications' | 'graphql-anonymous-me-denied';
export type AcceptanceResult = {
  status: 'disconnected' | 'passed' | 'failed';
  checks: { check: AcceptanceCheck; accepted: boolean }[];
};

type Dependencies = {
  tokenFor: typeof tokenFor;
  verifyGrant: typeof verifyFedizenReadGrant;
  readMe: typeof readNativeBonfireMe;
  readProfile: typeof readNativeBonfireProfile;
  readPage: typeof readNativeBonfirePage;
};

const live: Dependencies = {
  tokenFor,
  verifyGrant: verifyFedizenReadGrant,
  readMe: readNativeBonfireMe,
  readProfile: readNativeBonfireProfile,
  readPage: readNativeBonfirePage,
};

export function fedizenAcceptanceEnabled(value: string | undefined): boolean {
  return value === 'enabled';
}

/**
 * The sole account selector is the independently authenticated Atlas subject.
 * The HTTP handler must enforce Supabase auth and a matching expected subject.
 * Caller-injected dependencies exist only for deterministic offline tests.
 */
export async function probeAtlasFedizenConnection(
  authenticatedAtlasUserId: string,
  deps: Dependencies = live,
): Promise<AcceptanceResult> {
  const checks: AcceptanceResult['checks'] = [];
  const record = (check: AcceptanceCheck, accepted: boolean): boolean => {
    checks.push({ check, accepted });
    return accepted;
  };
  const failed = (): AcceptanceResult => ({ status: 'failed', checks });

  try {
    const connection = await deps.tokenFor(authenticatedAtlasUserId);
    if (!connection) return { status: 'disconnected', checks };

    // Reverify resource ownership independently of the stored handle.
    const verifiedRestHandle = await deps.verifyGrant(connection.access_token);
    if (!record('delegated-rest-owner', !!verifiedRestHandle &&
      matchesLinkedFedizenHandle(connection.account_handle, verifiedRestHandle))) return failed();

    const me = await deps.readMe(connection.access_token);
    const user = me?.user;
    if (!record('graphql-me-owner', !!user?.id && !!user.character?.username &&
      matchesLinkedFedizenHandle(verifiedRestHandle, user.character.username))) return failed();

    const ownProfile = await deps.readProfile(connection.access_token, { by: 'id', value: user!.id });
    if (!record('graphql-own-profile', !!ownProfile &&
      ownProfile.id === user!.id &&
      matchesLinkedFedizenHandle(verifiedRestHandle, ownProfile.character?.username))) return failed();

    const home = await deps.readPage(connection.access_token, 'myFeed');
    if (!record('graphql-my-feed', !!home && Array.isArray(home.nodes) &&
      (!home.pageInfo.hasNextPage || !!home.pageInfo.endCursor))) return failed();

    const notifications = await deps.readPage(connection.access_token, 'notifications');
    if (!record('graphql-notifications', !!notifications && Array.isArray(notifications.nodes) &&
      (!notifications.pageInfo.hasNextPage || !!notifications.pageInfo.endCursor))) return failed();

    let anonymousDenied = false;
    try {
      const anonymous = await deps.readMe('');
      anonymousDenied = isConclusiveAnonymousMeDenial(anonymous);
    } catch (error) {
      anonymousDenied = isConclusiveAnonymousMeDenial(undefined, error);
    }
    if (!record('graphql-anonymous-me-denied', anonymousDenied)) return failed();
    return { status: 'passed', checks };
  } catch {
    // An upstream failure is inconclusive. No raw upstream errors leak.
    return failed();
  }
}
