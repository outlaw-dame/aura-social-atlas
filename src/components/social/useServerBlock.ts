import { useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { changeFedizenServerBlock } from '@/lib/fedizen-profile.functions';
import { FEDIZEN_BLOCKED_URL } from '@/lib/fedizen-feed';
import { useAtlasAuth } from './AuthState';

/** A handle as name@server, whether it came with a leading "@" (as profiles show it) or not. */
export const bareAcct = (acct: string | undefined) => acct?.trim().replace(/^@/, '') ?? '';

/** The server part of a handle (name@server or @name@server), for accounts on other servers than Fedizen. */
export const serverOf = (acct: string | undefined): string | null => {
  const parts = bareAcct(acct).split('@');
  if (parts.length !== 2 || !parts[0] || parts[0].length > 100 || /[\s/#?]/.test(parts[0])) return null;
  const host = parts[1].toLowerCase();
  const labels = host.split('.');
  if (host === 'fedizen.net' || host.length > 253 || labels.length < 2 ||
      labels.some(label => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) return null;
  return host;
};

/** What blocking a server does, in Bonfire's terms (a block is ghost + silence, applied to everyone there). */
export const blockServerText = (host: string) => `You won’t see posts or notifications from anyone on ${host}, and they won’t see yours.`;

const SAID = {
  'not-found': (host: string) => `Fedizen doesn’t know ${host} yet.`,
  'own-server': () => 'That’s your own server.',
  'needs-permission': () => 'Reconnect Fedizen so Atlas can change your blocks.',
  'rate-limited': () => 'Fedizen is busy. Try again in a minute.',
} as Record<string, (host: string, on: boolean) => string>;

/** Never retain owner-specific Spotlight content across a server moderation
 * change while the new policy is pending. Other Atlas accounts are unaffected. */
export async function revokeSpotlightAfterServerBlock(qc: QueryClient, accountId: string): Promise<void> {
  await qc.cancelQueries({ queryKey: ['spotlight-viewer', accountId] });
  qc.setQueryData(['spotlight-viewer', accountId], { items: [], moderation: null });
  void Promise.allSettled(['spotlight-viewer', 'fedizen-home', 'fedizen-foryou', 'fedizen-notifications']
    .map(k => qc.invalidateQueries({ queryKey: [k] })));
}

/**
 * Blocks or unblocks a whole server for the person, as Mastodon's "Block domain" (Bonfire's API offers no direct way:
 * see changeFedizenServerBlock). Bonfire's answer never says whether it worked (server-block.server.ts); tried live,
 * the block did, so a request Fedizen took is reported as done, with where to see it.
 */
export function useServerBlock() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const send = useServerFn(changeFedizenServerBlock);
  const [busy, setBusy] = useState(false);
  const change = async (acct: string, on: boolean): Promise<string> => {
    const host = serverOf(acct);
    if (!user || !host) return 'Sign in to Atlas and connect Fedizen first.';
    setBusy(true);
    try {
      const r = await send({ data: { expectedAtlasUserId: user.id, acct: bareAcct(acct), on } });
      if (r.ok) {
        await revokeSpotlightAfterServerBlock(qc, user.id);
        return r.outcome === 'done' ? `${host} ${on ? 'blocked' : 'unblocked'}.`
          : `Fedizen could not confirm ${on ? 'blocking' : 'unblocking'} ${host}. Check its Blocked page.`;
      }
      return (SAID[r.error] ?? (() => 'Couldn’t reach Fedizen. Try again.'))(host, on);
    } catch {
      return 'Couldn’t reach Fedizen. Try again.';
    } finally { setBusy(false); }
  };
  return { change, busy, blockedPage: FEDIZEN_BLOCKED_URL };
}
