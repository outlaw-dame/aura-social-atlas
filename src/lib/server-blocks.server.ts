/**
 * Reading and changing the servers a person blocks in Atlas (atlas_blocked_servers; see server-blocklist.ts).
 * Server-only, through the service role, always scoped to one Atlas account.
 */
import { MAX_BLOCKED_SERVERS } from './server-blocklist';

type Ordered = {
  order(c: string, o: { ascending: boolean }): Ordered;
  range(from: number, to: number): Promise<{ data: unknown; error: unknown }>;
};
type Db = {
  from(table: string): {
    select(cols: string): { eq(c: string, v: string): Ordered };
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

/** Rows a page: Supabase answers at most 1,000 rows a request by default (its API's max rows), whatever the limit. */
export const PAGE = 1000;

/**
 * The person's blocked servers, newest first, all of them: read a page at a time in a fixed order (newest first, then
 * by name) until a page comes back short. Null when any page couldn't be read: a partial list would let servers
 * through, so callers treat null as "can't tell".
 */
export async function blockedServersOf(userId: string): Promise<string[] | null> {
  try {
    const db = await blockDeps.db();
    const out: string[] = [];
    for (let from = 0; from < MAX_BLOCKED_SERVERS + PAGE; from += PAGE) {
      const { data, error } = await db.from(TABLE).select('domain').eq('user_id', userId)
        .order('added_at', { ascending: false }).order('domain', { ascending: true }).range(from, from + PAGE - 1);
      if (error || !Array.isArray(data)) return null;
      for (const r of data as { domain: unknown }[]) if (typeof r.domain === 'string') out.push(r.domain);
      if (data.length < PAGE) return out;
    }
    return out;
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
