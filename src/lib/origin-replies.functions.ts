import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { assertFedizenSessionIntent } from './fedizen-feed';
import { authorsToCheck, originOf, originReplies, visibleOriginReplies, withFedizenIds, type AuthorCheck, type OriginReply } from './origin-replies';

/**
 * A remote post's replies as its own server has them (GET /api/v1/statuses/:id/context there, public posts only), for
 * the conversation view to add the ones Fedizen lacks (origin-replies.ts), with the reader's blocks and mutes applied
 * (visibleOriginReplies): Fedizen never saw these replies, so its own filtering didn't either.
 *
 * The origin read is public data, through safeFetch (public https only, every hop's addresses checked, redirects
 * re-validated, 3.5 s, 512 KB), kept a minute per post so a conversation left open doesn't keep asking. The reader's
 * moderation is read with their own Fedizen grant on the server, never cached across people, and when it can't be read
 * completely no origin replies are shown. Empty when the server doesn't answer this way.
 */
const kept = new Map<string, { at: number; replies: OriginReply[] }>();
const KEEP_MS = 60_000;
const LOOKUPS_AT_ONCE = 8;

async function readOrigin(host: string, id: string): Promise<OriginReply[]> {
  const k = `${host}/${id}`;
  const hit = kept.get(k);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.replies;
  const { safeFetch } = await import('./article-author.server');
  const res = await safeFetch(`https://${host}/api/v1/statuses/${id}/context`, 'application/json').catch(() => null);
  let replies: OriginReply[] = [];
  try {
    const body = res ? JSON.parse(res.text) as { descendants?: unknown } : null;
    replies = originReplies(body?.descendants, host);
  } catch { /* not this API */ }
  kept.set(k, { at: Date.now(), replies });
  if (kept.size > 500) kept.delete(kept.keys().next().value!);
  return replies;
}

export const getOriginReplies = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const { url, expectedAtlasUserId } = z.object({ url: z.string().max(2048), expectedAtlasUserId: z.string().uuid() }).strict().parse(d);
    const origin = originOf(url);
    if (!origin) throw new Error('Not a post address Atlas can read replies for.');
    return { ...origin, expectedAtlasUserId };
  })
  .handler(async ({ data, context }): Promise<{ replies: OriginReply[] }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { tokenFor, fedizenGet } = await import('./fedizen.server');
    const t = await tokenFor(context.userId);
    if (!t) return { replies: [] };
    const replies = await readOrigin(data.host, data.id);
    if (!replies.length) return { replies: [] };

    const [{ readSpotlightModeration }, { readOwnerNativeModeration, mergeVerifiedOwnerModeration }, { inPool }, { blockedServersOf, withAtlasServers }] = await Promise.all([
      import('./spotlight-moderation.server'), import('./spotlight-native-moderation.server'), import('./in-pool'), import('./server-blocks.server'),
    ]);
    const authors = authorsToCheck(replies);
    const [rest, native, looked, atlasServers] = await Promise.all([
      readSpotlightModeration(path => fedizenGet(t.access_token, path, { requireCompleteModeration: true })),
      readOwnerNativeModeration(t.access_token, t.account_handle ?? ''),
      // Each author as Fedizen knows them: its id there, or not known to it (404), or no answer.
      inPool(authors, LOOKUPS_AT_ONCE, async acct => {
        const r = await fedizenGet(t.access_token, `/api/v1/accounts/lookup?acct=${encodeURIComponent(acct)}`).catch(() => null);
        const id = r?.status === 200 ? (r.data[0] as { id?: unknown } | undefined)?.id : undefined;
        return { acct, id: typeof id === 'string' ? id : undefined, unknown: r?.status === 404 };
      }).catch(() => null),
      // The servers they block in Atlas (Fedizen gives apps no list of the ones blocked there).
      blockedServersOf(context.userId),
    ]);
    const moderation = withAtlasServers(mergeVerifiedOwnerModeration(rest, native), atlasServers);
    if (!moderation || !looked) return { replies: [] };

    const known = looked.filter((l): l is typeof l & { id: string } => !!l.id);
    const relations = new Map<string, { blocking?: boolean | null; muting?: boolean | null; domain_blocking?: boolean | null }>();
    if (known.length) {
      const q = known.map(l => `id%5B%5D=${encodeURIComponent(l.id)}`).join('&');
      const r = await fedizenGet(t.access_token, `/api/v1/accounts/relationships?${q}`).catch(() => null);
      if (r?.status !== 200) return { replies: [] };
      for (const rel of r.data as { id: string; blocking?: boolean | null; muting?: boolean | null; domain_blocking?: boolean | null }[]) relations.set(rel.id, rel);
    }
    const checks = new Map<string, AuthorCheck>(looked.map(l => {
      if (l.id) {
        const rel = relations.get(l.id);
        return [l.acct, rel ? { state: 'known', ...rel } : { state: 'unreadable' }];
      }
      return [l.acct, l.unknown ? { state: 'unknown' } : { state: 'unreadable' }];
    }));
    const ids = new Map(known.map(l => [l.acct, l.id] as const));
    return { replies: withFedizenIds(visibleOriginReplies(replies, moderation, checks), ids) };
  });
