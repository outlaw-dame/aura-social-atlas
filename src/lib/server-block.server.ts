/** Blocking a whole server for one person through Bonfire's GraphQL (see BLOCK_SERVER_DOCUMENT for why it's indirect). */
import { z } from 'zod';
import { requestBonfireGraphQL } from './bonfire-graphql.server';
import { ACCOUNT_SERVER_DOCUMENT, BLOCK_SERVER_DOCUMENT, UNBLOCK_SERVER_DOCUMENT } from './bonfire/graphql/operations';

export type ServerBlockOutcome = 'done' | 'not-done' | 'unconfirmed';

const serverOf = z.object({ user: z.object({ character: z.object({ peered: z.object({ peerId: z.string().min(1).max(64), canonicalUri: z.string().max(2048).nullish() }).nullish() }).nullish() }).nullish() });

/** The Bonfire id of the server `acct` (name@host) lives on, only when the account's own address is on that host. */
export async function serverIdFor(accessToken: string, acct: string): Promise<string | null> {
  const host = acct.split('@')[1]?.toLowerCase();
  if (!host) return null;
  return requestBonfireGraphQL({
    operation: 'query', document: ACCOUNT_SERVER_DOCUMENT, accessToken, variables: { username: acct },
    validate: data => {
      const peered = serverOf.parse(data).user?.character?.peered;
      if (!peered?.canonicalUri) return null;
      let at: string;
      try {
        const actor = new URL(peered.canonicalUri);
        if (actor.protocol !== 'https:' || actor.username || actor.password || actor.port) return null;
        at = actor.hostname.toLowerCase();
      } catch { return null; }
      // A peer's origin may be a subdomain of the WebFinger handle domain.
      // NEVER accept the reverse: it could block a broader parent server than
      // the person actually chose in the confirmation dialog.
      return at === host || at.endsWith(`.${host}`) ? peered.peerId : null;
    },
  });
}

/** Blocks or unblocks that server. Never retried (a mutation). */
export async function changeServerBlock(accessToken: string, serverId: string, on: boolean): Promise<ServerBlockOutcome> {
  const failed = on ? 'Could not block user' : 'Could not unblock user';
  try {
    return await requestBonfireGraphQL<ServerBlockOutcome>({
      operation: 'mutation', document: on ? BLOCK_SERVER_DOCUMENT : UNBLOCK_SERVER_DOCUMENT, accessToken, variables: { id: serverId },
      validate: data => (data && typeof data === 'object' && (data as Record<string, unknown>)[on ? 'blockUser' : 'unblockUser'] ? 'done' : 'unconfirmed'),
      knownErrors: { known: [failed], result: () => 'not-done' },
    });
  } catch (e) {
    // Any other GraphQL error is what success looks like here (the resolver can't load a server as a user).
    if ((e as { kind?: string })?.kind === 'graphql') return 'unconfirmed';
    throw e;
  }
}
