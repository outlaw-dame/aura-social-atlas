import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { changeFedizenServerBlock } from '@/lib/fedizen-profile.functions';
import { FEDIZEN_BLOCKED_URL } from '@/lib/fedizen-feed';
import { useAtlasAuth } from './AuthState';

/** The server part of a handle (name@server), for accounts on other servers than Fedizen. */
export const serverOf = (acct: string | undefined) => {
  const host = acct?.split('@')[1]?.toLowerCase();
  return host && host !== 'fedizen.net' ? host : null;
};

/** What blocking a server does, in Bonfire's terms (a block is ghost + silence, applied to everyone there). */
export const blockServerText = (host: string) => `You won’t see posts or notifications from anyone on ${host}, and they won’t see yours.`;

const SAID = {
  'not-done': (host: string, on: boolean) => `Fedizen didn’t ${on ? 'block' : 'unblock'} ${host}.`,
  'not-found': (host: string) => `Fedizen doesn’t know ${host} yet.`,
  'own-server': () => 'That’s your own server.',
  'needs-permission': () => 'Reconnect Fedizen so Atlas can change your blocks.',
  'rate-limited': () => 'Fedizen is busy. Try again in a minute.',
} as Record<string, (host: string, on: boolean) => string>;

/**
 * Blocks or unblocks a whole server for the person, as Mastodon's "Block domain" (Bonfire's API offers no direct way:
 * see changeFedizenServerBlock). Bonfire answers a block that worked with an error it can't avoid, so the result is
 * often "sent" rather than "done"; both say where to check. Fedizen's Blocked page lists them.
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
      const r = await send({ data: { expectedAtlasUserId: user.id, acct, on } });
      if (r.ok) {
        void Promise.all(['fedizen-home', 'fedizen-foryou', 'fedizen-notifications'].map(k => qc.invalidateQueries({ queryKey: [k] })));
        return r.outcome === 'done' ? `${host} ${on ? 'blocked' : 'unblocked'}.`
          : `Sent to Fedizen. It can’t confirm server ${on ? 'blocks' : 'unblocks'} to apps yet; its Blocked page shows them.`;
      }
      return (SAID[r.error] ?? (() => 'Couldn’t reach Fedizen. Try again.'))(host, on);
    } catch {
      return 'Couldn’t reach Fedizen. Try again.';
    } finally { setBusy(false); }
  };
  return { change, busy, blockedPage: FEDIZEN_BLOCKED_URL };
}
