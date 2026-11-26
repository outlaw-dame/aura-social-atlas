import { createServerFn } from '@tanstack/react-start';
import { originOf, originReplies, type OriginReply } from './origin-replies';

/**
 * A remote post's replies as its own server has them (GET /api/v1/statuses/:id/context there, public posts only), for
 * the conversation view to add the ones Fedizen lacks (origin-replies.ts). Public data, read through safeFetch (public
 * https only, every hop's addresses checked, redirects re-validated, 3.5 s, 512 KB); kept a minute per post so a
 * conversation left open doesn't keep asking. Empty when the server doesn't answer this way.
 */
const kept = new Map<string, { at: number; replies: OriginReply[] }>();
const KEEP_MS = 60_000;

export const getOriginReplies = createServerFn({ method: 'GET' })
  .inputValidator((d: { url: string }) => {
    const origin = originOf(String(d?.url ?? ''));
    if (!origin) throw new Error('Not a post address Atlas can read replies for.');
    return origin;
  })
  .handler(async ({ data }): Promise<{ replies: OriginReply[] }> => {
    const k = `${data.host}/${data.id}`;
    const hit = kept.get(k);
    if (hit && Date.now() - hit.at < KEEP_MS) return { replies: hit.replies };
    const { safeFetch } = await import('./article-author.server');
    const res = await safeFetch(`https://${data.host}/api/v1/statuses/${data.id}/context`, 'application/json').catch(() => null);
    let replies: OriginReply[] = [];
    try {
      const body = res ? JSON.parse(res.text) as { descendants?: unknown } : null;
      replies = originReplies(body?.descendants);
    } catch { /* not this API */ }
    kept.set(k, { at: Date.now(), replies });
    if (kept.size > 500) kept.delete(kept.keys().next().value!);
    return { replies };
  });
