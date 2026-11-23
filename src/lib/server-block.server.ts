/** Blocking a whole server for one person through Bonfire's GraphQL (see BLOCK_SERVER_DOCUMENT for why it's indirect). */
import { z } from 'zod';
import { requestBonfireGraphQL } from './bonfire-graphql.server';
import { ACCOUNT_SERVER_DOCUMENT, BLOCK_SERVER_DOCUMENT, UNBLOCK_SERVER_DOCUMENT } from './bonfire/graphql/operations';

export type ServerBlockOutcome = 'done' | 'unconfirmed';

const serverOf = z.object({ user: z.object({ character: z.object({ peered: z.object({ peerId: z.string().min(1).max(64), canonicalUri: z.string().max(2048).nullish() }).nullish() }).nullish() }).nullish() });

/**
 * The Bonfire id of the server `acct` (name@host) lives on, only when the account's own address is on that host. Read
 * signed out: once the person has blocked a server, Bonfire no longer shows them its accounts, so a signed-in lookup
 * finds nothing to unblock (seen live, 23 Nov 2026). Which server an account is on is public.
 */
export async function serverIdFor(acct: string): Promise<string | null> {
  const host = acct.split('@')[1]?.toLowerCase();
  if (!host) return null;
  return requestBonfireGraphQL({
    operation: 'query', document: ACCOUNT_SERVER_DOCUMENT, variables: { username: acct },
    validate: data => {
      const peered = serverOf.parse(data).user?.character?.peered;
      if (!peered?.canonicalUri) return null;
      let at: string;
      try { at = new URL(peered.canonicalUri).hostname.toLowerCase(); } catch { return null; }
      // The account's address must be on the server being blocked (or a subdomain of it, as Lemmy's and Misskey's can be).
      return at === host || at.endsWith(`.${host}`) || host.endsWith(`.${at}`) ? peered.peerId : null;
    },
  });
}

/**
 * Blocks or unblocks that server. Never retried (a mutation). Bonfire's answer says nothing either way: its check after
 * the change only recognises people, so a server block that worked comes back "Could not block user" (seen live on
 * Fedizen, 23 Nov 2026: the server was on the Blocked page all the same), and an unblock comes back as an error loading
 * the server as a user. Only a transport failure means it surely didn't happen.
 */
export async function changeServerBlock(accessToken: string, serverId: string, on: boolean): Promise<ServerBlockOutcome> {
  try {
    return await requestBonfireGraphQL<ServerBlockOutcome>({
      operation: 'mutation', document: on ? BLOCK_SERVER_DOCUMENT : UNBLOCK_SERVER_DOCUMENT, accessToken, variables: { id: serverId },
      validate: data => (data && typeof data === 'object' && (data as Record<string, unknown>)[on ? 'blockUser' : 'unblockUser'] ? 'done' : 'unconfirmed'),
    });
  } catch (e) {
    if ((e as { kind?: string })?.kind === 'graphql') return 'unconfirmed';
    throw e;
  }
}
