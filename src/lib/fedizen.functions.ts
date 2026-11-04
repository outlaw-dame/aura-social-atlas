import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { allowedCallback, fromNotifications, fromStatuses, type FedizenNotice, type FedizenPost } from './fedizen-feed';

export const getFedizenStatus = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { tokenFor } = await import('./fedizen.server');
  const t = await tokenFor(context.userId);
  return { connected: !!t, handle: t?.account_handle ?? null };
});

export const startFedizenConnect = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ origin: z.string().max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const redirect = allowedCallback(data.origin);
    if (!redirect) return { url: null, error: 'This address can’t connect to Fedizen.' };
    const { startConnect } = await import('./fedizen.server');
    try { return { url: await startConnect(context.userId, redirect), error: null }; }
    catch (e) { console.error(e); return { url: null, error: 'Fedizen couldn’t be reached. Try again shortly.' }; }
  });

export const finishFedizenConnect = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ code: z.string().min(1).max(2000), state: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { finishConnect } = await import('./fedizen.server');
    return finishConnect(context.userId, data.code, data.state);
  });

export const disconnectFedizen = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { disconnect } = await import('./fedizen.server');
  await disconnect(context.userId); return { ok: true };
});

export type FedizenHome = { connected: boolean; posts: FedizenPost[]; notices: FedizenNotice[]; error?: 'expired' | 'unavailable' };
export const getFedizenHome = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }): Promise<FedizenHome> => {
  const { tokenFor, fedizenGet } = await import('./fedizen.server');
  const t = await tokenFor(context.userId);
  if (!t) return { connected: false, posts: [], notices: [] };
  const [home, notes] = await Promise.all([fedizenGet(t.access_token, '/api/v1/timelines/home?limit=20'), fedizenGet(t.access_token, '/api/v1/notifications?limit=20')]);
  const error = home.status === 401 ? 'expired' : home.status !== 200 ? 'unavailable' : undefined;
  return { connected: true, posts: fromStatuses(home.data as never), notices: fromNotifications(notes.data as never), error };
});
