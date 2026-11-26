/**
 * Reading and changing the servers a person blocks in Atlas (atlas_blocked_servers; see server-blocklist.ts).
 * Server-only, through the service role, always scoped to one Atlas account.
 */
import { MAX_BLOCKED_SERVERS } from './server-blocklist';

type Db = {
  from(table: string): {
    select(cols: string): { eq(c: string, v: string): { order(c: string, o: { ascending: boolean }): { limit(n: number): Promise<{ data: unknown; error: unknown }> } } };
    upsert(rows: unknown[], o: { onConflict: string; ignoreDuplicates: boolean }): Promise<{ error: unknown }>;
    delete(): { eq(c: string, v: string): { in(c: string, v: string[]): Promise<{ error: unknown }> } & Promise<{ error: unknown }> };
  };
};
const TABLE = 'atlas_blocked_servers';

export const blockDeps = {
  db: async (): Promise<Db> => (await import('@/integrations/supabase/client.server')).supabaseAdmin as unknown as Db,
};

/**
 * A moderation snapshot with the servers the person blocks in Atlas added to its blocked servers. Null (show nothing
 * from other servers) when the snapshot is missing or the Atlas list couldn't be read.
 */
export function withAtlasServers<M extends { blockedDomains: string[] }>(moderation: M | null, atlas: string[] | null): M | null {
  if (!moderation || !atlas) return null;
  return atlas.length ? { ...moderation, blockedDomains: [...new Set([...moderation.blockedDomains, ...atlas])] } : moderation;
}

/** The person's blocked servers, newest first; null when they couldn't be read (callers decide what that means). */
export async function blockedServersOf(userId: string): Promise<string[] | null> {
  try {
    const db = await blockDeps.db();
    const { data, error } = await db.from(TABLE).select('domain').eq('user_id', userId).order('added_at', { ascending: false }).limit(MAX_BLOCKED_SERVERS);
    if (error || !Array.isArray(data)) return null;
    return (data as { domain: unknown }[]).map(r => r.domain).filter((d): d is string => typeof d === 'string');
  } catch { return null; }
}

/** Adds servers (already normalized); ones already there stay as they were. Only as many as fit under the cap. */
export async function addBlockedServers(userId: string, domains: string[]): Promise<{ added: number; already: number; overLimit: number } | null> {
  const have = await blockedServersOf(userId);
  if (!have) return null;
  const known = new Set(have);
  const fresh = [...new Set(domains)].filter(d => !known.has(d));
  const room = Math.max(0, MAX_BLOCKED_SERVERS - have.length);
  const rows = fresh.slice(0, room).map(domain => ({ user_id: userId, domain }));
  try {
    const db = await blockDeps.db();
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await db.from(TABLE).upsert(rows.slice(i, i + 1000), { onConflict: 'user_id,domain', ignoreDuplicates: true });
      if (error) return null;
    }
  } catch { return null; }
  return { added: rows.length, already: domains.length - fresh.length, overLimit: fresh.length - rows.length };
}

/** Removes these servers, or every one when `domains` is 'all'. */
export async function removeBlockedServers(userId: string, domains: string[] | 'all'): Promise<boolean> {
  try {
    const db = await blockDeps.db();
    const q = db.from(TABLE).delete().eq('user_id', userId);
    const { error } = domains === 'all' ? await q : await q.in('domain', domains);
    return !error;
  } catch { return false; }
}
