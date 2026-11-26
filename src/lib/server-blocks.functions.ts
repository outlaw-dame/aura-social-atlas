import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { assertFedizenSessionIntent } from './fedizen-feed';
import { MAX_BLOCKED_SERVERS, MAX_BLOCKLIST_CHARS, normalizeServer, parseBlocklist, type SkipReason } from './server-blocklist';

/**
 * Settings → Moderation → Blocked servers: the servers the person blocks in Atlas (server-blocklist.ts). Each call is
 * the signed-in person's own list (Supabase auth and the session they expect); Fedizen isn't asked or changed.
 */
type Problem = 'storage' | 'full' | 'invalid' | 'own-server';
/** Fedizen itself: blocking it would hide the person's own server, posts and all. */
const OWN = 'fedizen.net';
const me = z.object({ expectedAtlasUserId: z.string().uuid() });

export const getBlockedServers = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.strict().parse(d))
  .handler(async ({ data, context }): Promise<{ servers: string[]; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { blockedServersOf } = await import('./server-blocks.server');
    const servers = await blockedServersOf(context.userId);
    return servers ? { servers } : { servers: [], error: 'storage' };
  });

/** One server, typed in (a name or an address). */
export const addBlockedServer = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ server: z.string().min(1).max(300) }).strict().parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; server: string; already: boolean } | { ok: false; error: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const server = normalizeServer(data.server.replace(/^\*\./, ''));
    if (!server) return { ok: false, error: 'invalid' };
    if (server === OWN || server.endsWith(`.${OWN}`)) return { ok: false, error: 'own-server' };
    const { addBlockedServers } = await import('./server-blocks.server');
    const r = await addBlockedServers(context.userId, [server]);
    if (!r) return { ok: false, error: 'storage' };
    if (r.overLimit) return { ok: false, error: 'full' };
    return { ok: true, server, already: r.already > 0 };
  });

/** A blocklist file's text (Mastodon CSV, plain text or JSON): its servers are added to the list. */
export const importBlockedServers = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ text: z.string().max(MAX_BLOCKLIST_CHARS) }).strict().parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; added: number; already: number; overLimit: number; skipped: Record<SkipReason | 'own', number> } | { ok: false; error: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const parsed = parseBlocklist(data.text);
    const own = parsed.domains.filter(d => d === OWN || d.endsWith(`.${OWN}`));
    const domains = parsed.domains.filter(d => !own.includes(d));
    const skipped = { ...parsed.skipped, own: own.length };
    if (!domains.length) return parsed.skipped.invalid || parsed.skipped.hidden || parsed.skipped.limited || own.length
      ? { ok: true, added: 0, already: 0, overLimit: 0, skipped } : { ok: false, error: 'invalid' };
    const { addBlockedServers } = await import('./server-blocks.server');
    const r = await addBlockedServers(context.userId, domains);
    return r ? { ok: true, ...r, skipped } : { ok: false, error: 'storage' };
  });

/** Takes servers off the list (unblocks them in Atlas), or clears it. */
export const removeBlockedServers = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ servers: z.union([z.literal('all'), z.array(z.string().min(3).max(253)).min(1).max(MAX_BLOCKED_SERVERS)]) }).strict().parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { removeBlockedServers: remove } = await import('./server-blocks.server');
    const servers = data.servers === 'all' ? 'all' as const : data.servers.map(s => normalizeServer(s)).filter((s): s is string => !!s);
    if (servers !== 'all' && !servers.length) return { ok: false, error: 'invalid' };
    return (await remove(context.userId, servers)) ? { ok: true } : { ok: false, error: 'storage' };
  });
