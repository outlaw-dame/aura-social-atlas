import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { addBlockedServer, getBlockedServers, importBlockedServers, removeBlockedServers } from '@/lib/server-blocks.functions';
import { MAX_BLOCKED_SERVERS, MAX_BLOCKLIST_CHARS, blocklistCsv } from '@/lib/server-blocklist';
import { useAtlasAuth } from './AuthState';
import { revokeOriginReplies } from './originRepliesCache';

const KEY = 'atlas-blocked-servers';
const SAID: Record<string, string> = {
  storage: 'Atlas couldn’t save that. Try again.',
  full: `Your list is full (${MAX_BLOCKED_SERVERS.toLocaleString()} servers). Remove some first.`,
  invalid: 'That isn’t a server name. Try one like spam.example.',
  'own-server': 'That’s your own server, Fedizen.',
  unavailable: 'Atlas couldn’t reach its server. Try again.',
};

/** What an import did, in a line: added, already there, skipped and why. */
export function importSummary(r: { added: number; already: number; overLimit: number; skipped: { limited: number; hidden: number; invalid: number; own: number } }): string {
  const n = (k: number, one: string, many = `${one}s`) => `${k.toLocaleString()} ${k === 1 ? one : many}`;
  const parts = [r.added ? `Added ${n(r.added, 'server')}` : 'No new servers'];
  if (r.already) parts.push(`${r.already.toLocaleString()} already listed`);
  if (r.overLimit) parts.push(`${n(r.overLimit, 'server')} left out: the list is full`);
  if (r.skipped.limited) parts.push(`${n(r.skipped.limited, 'limit')} skipped (only blocks are imported)`);
  if (r.skipped.hidden) parts.push(`${n(r.skipped.hidden, 'hidden name')} skipped`);
  if (r.skipped.invalid) parts.push(`${n(r.skipped.invalid, 'line')} that ${r.skipped.invalid === 1 ? 'isn’t a server' : 'aren’t servers'}`);
  if (r.skipped.own) parts.push('your own server left out');
  return `${parts.join(' · ')}.`;
}

/**
 * The servers the person blocks in Atlas (server-blocklist.ts), and adding, importing and removing them. Changes
 * reread every list that hides by it, so a newly blocked server's posts don't linger.
 */
export function useBlockedServers(enabled = true) {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const read = useServerFn(getBlockedServers), add = useServerFn(addBlockedServer), load = useServerFn(importBlockedServers), remove = useServerFn(removeBlockedServers);
  const q = useQuery({
    queryKey: [KEY, user?.id],
    queryFn: () => read({ data: { expectedAtlasUserId: user!.id } }),
    enabled: !!user && enabled, staleTime: 5 * 60_000,
  });
  const [note, setNote] = useState<{ text: string; problem: boolean } | null>(null);
  const changed = async () => {
    if (!user) return;
    await qc.invalidateQueries({ queryKey: [KEY, user.id] });
    // Spotlight's cards were chosen under the old list: none until it's read again (as after a block on Fedizen).
    await qc.cancelQueries({ queryKey: ['spotlight-viewer', user.id] });
    qc.setQueryData(['spotlight-viewer', user.id], { items: [], moderation: null });
    void qc.invalidateQueries({ queryKey: ['spotlight-viewer'] });
    await revokeOriginReplies(qc, user.id);
  };
  const m = useMutation({
    mutationFn: async (run: () => Promise<{ text: string; problem: boolean }>) => run(),
    onSuccess: async r => { setNote(r); if (!r.problem) await changed(); },
    onError: () => setNote({ text: SAID.unavailable, problem: true }),
  });
  const servers = useMemo(() => q.data?.servers ?? [], [q.data]);
  const me = user ? { expectedAtlasUserId: user.id } : null;
  return {
    signedIn: !!user,
    servers,
    loading: q.isLoading,
    readError: q.data?.error || q.isError ? SAID[q.data?.error ?? 'unavailable'] : null,
    busy: m.isPending,
    note, clearNote: () => setNote(null),
    block: (server: string) => me && m.mutateAsync(async () => {
      const r = await add({ data: { ...me, server } });
      return r.ok ? { text: r.already ? `${r.server} is already on your list.` : `${r.server} blocked in Atlas.`, problem: false } : { text: SAID[r.error], problem: true };
    }),
    importFile: (file: File) => me && m.mutateAsync(async () => {
      if (file.size > MAX_BLOCKLIST_CHARS * 2) return { text: 'That file is too large for a blocklist.', problem: true };
      const text = await file.text();
      if (text.length > MAX_BLOCKLIST_CHARS) return { text: 'That file is too large for a blocklist.', problem: true };
      const r = await load({ data: { ...me, text } });
      return r.ok ? { text: importSummary(r), problem: false } : { text: r.error === 'invalid' ? 'No servers found in that file. Atlas reads Mastodon’s CSV, plain text (one server a line) and JSON.' : SAID[r.error], problem: true };
    }),
    unblock: (servers: string[] | 'all') => me && m.mutateAsync(async () => {
      const r = await remove({ data: { ...me, servers } });
      return r.ok ? { text: servers === 'all' ? 'Your list is empty.' : `${servers.join(', ')} unblocked in Atlas.`, problem: false } : { text: SAID[r.error ?? 'storage'], problem: true };
    }),
  };
}

/** Saves the list as Mastodon's CSV (atlas-blocked-servers.csv), which Mastodon, GoToSocial and Atlas can import. */
export function exportBlocklist(servers: readonly string[]) {
  const url = URL.createObjectURL(new Blob([blocklistCsv(servers)], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'atlas-blocked-servers.csv' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** File types the import accepts. */
export const BLOCKLIST_ACCEPT = '.csv,.txt,.json,text/csv,text/plain,application/json';
